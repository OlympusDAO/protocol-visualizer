package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var testAllowedChains = map[int]struct{}{
	1:        {},
	10:       {},
	11155111: {},
}

type fakeS3 struct {
	key       string
	headKey   string
	headError error
}

func (f *fakeS3) GetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	if input.Key == nil {
		return nil, errors.New("missing key")
	}
	f.key = *input.Key
	body := []byte(`{"ok":true}` + "\n")
	lastModified := time.Date(2026, 5, 25, 0, 0, 0, 0, time.UTC)
	return &s3.GetObjectOutput{
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: aws.Int64(int64(len(body))),
		ETag:          aws.String(`"etag"`),
		LastModified:  &lastModified,
	}, nil
}

func (f *fakeS3) HeadObject(_ context.Context, input *s3.HeadObjectInput, _ ...func(*s3.Options)) (*s3.HeadObjectOutput, error) {
	if input.Key == nil {
		return nil, errors.New("missing key")
	}
	f.headKey = *input.Key
	if f.headError != nil {
		return nil, f.headError
	}
	return &s3.HeadObjectOutput{}, nil
}

func TestResolveRouteAllowsOnlyKnownPaths(t *testing.T) {
	testCases := map[string]string{
		"/v1/index.html":                               "v1/index.html",
		"/v1/manifest.json":                            "v1/manifest.json",
		"/v1/schemas/manifest-v1.schema.json":          "v1/schemas/manifest-v1.schema.json",
		"/v1/schemas/protocol-snapshot-v1.schema.json": "v1/schemas/protocol-snapshot-v1.schema.json",
		"/v1/chain/1/protocol.json":                    "v1/chain/1/protocol.json",
		"/v1/chain/11155111/protocol.json":             "v1/chain/11155111/protocol.json",
	}

	for path, key := range testCases {
		t.Run(path, func(t *testing.T) {
			resolved, ok := resolveRoute(path, testAllowedChains)
			if !ok {
				t.Fatalf("expected route to resolve")
			}
			if resolved.key != key {
				t.Fatalf("expected key %s, got %s", key, resolved.key)
			}
		})
	}
}

func TestResolveRouteRejectsUnknownPaths(t *testing.T) {
	for _, path := range []string{
		"/",
		"/v1",
		"/v1/chain/999/protocol.json",
		"/v1/chain/1/other.json",
		"/v1/chain/1/../manifest.json",
	} {
		t.Run(path, func(t *testing.T) {
			if _, ok := resolveRoute(path, testAllowedChains); ok {
				t.Fatalf("expected route to be rejected")
			}
		})
	}
}

func TestGatewayRejectsUnsupportedMethods(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/manifest.json", nil)
	server{bucket: "bucket", s3: &fakeS3{}, allowedChains: testAllowedChains}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", recorder.Code)
	}
	if recorder.Header().Get("Allow") != "GET, HEAD" {
		t.Fatalf("expected Allow header")
	}
}

func TestGatewayRejectsRequestBodies(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/manifest.json", bytes.NewBufferString("{}"))
	server{bucket: "bucket", s3: &fakeS3{}, allowedChains: testAllowedChains}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestReadyRequiresManifestAccess(t *testing.T) {
	fake := &fakeS3{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	server{bucket: "bucket", s3: fake, allowedChains: testAllowedChains}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if fake.headKey != "v1/manifest.json" {
		t.Fatalf("unexpected ready object key %s", fake.headKey)
	}
}

func TestReadyFailsWhenManifestIsUnavailable(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	server{
		bucket:        "bucket",
		s3:            &fakeS3{headError: errors.New("missing")},
		allowedChains: testAllowedChains,
	}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
}

func TestGatewayStreamsAllowedObjectWithCacheHeaders(t *testing.T) {
	fake := &fakeS3{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/chain/1/protocol.json", nil)
	server{bucket: "bucket", s3: fake, allowedChains: testAllowedChains}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if fake.key != "v1/chain/1/protocol.json" {
		t.Fatalf("unexpected object key %s", fake.key)
	}
	if recorder.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected content type %s", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Cache-Control") == "" {
		t.Fatalf("expected cache header")
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("expected nosniff header")
	}
}

func TestGatewaySupportsHeadWithoutBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodHead, "/v1/manifest.json", nil)
	server{bucket: "bucket", s3: &fakeS3{}, allowedChains: testAllowedChains}.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("expected empty HEAD body")
	}
}

func TestLoadAllowedChainsFromConfig(t *testing.T) {
	configPath := firstExistingPath(t, []string{
		"../../packages/protocol-config/protocol-chains.json",
		"config/protocol-chains.json",
	})
	allowed, err := loadAllowedChains(configPath)
	if err != nil {
		t.Fatalf("expected chain config to load: %v", err)
	}
	if _, ok := allowed[42161]; !ok {
		t.Fatalf("expected Arbitrum chain id from shared config")
	}
}

func firstExistingPath(t *testing.T, candidates []string) string {
	t.Helper()
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	t.Fatalf("none of the candidate config paths exists: %v", candidates)
	return ""
}
