package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const (
	defaultPort       = "8080"
	defaultChainsPath = "config/protocol-chains.json"
	bucketRoot        = "v1"
	corsAllowOrigin   = "*"
)

type route struct {
	key          string
	contentType  string
	cacheControl string
}

type objectGetter interface {
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
}

type server struct {
	bucket        string
	s3            objectGetter
	allowedChains map[int]struct{}
}

type chainConfig struct {
	Key             string `json:"key"`
	ChainID         int    `json:"chainId"`
	Name            string `json:"name"`
	ExplorerBaseURL string `json:"explorerBaseUrl"`
}

func main() {
	ctx := context.Background()
	bucket := requiredEnv("BUCKET")
	client, err := newS3Client(ctx)
	if err != nil {
		log.Fatalf("failed to configure S3 client: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	allowedChains, err := loadAllowedChains(chainConfigPath())
	if err != nil {
		log.Fatalf("failed to load protocol chain config: %v", err)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           server{bucket: bucket, s3: client, allowedChains: allowedChains},
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("snapshot gateway listening on port %s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("snapshot gateway failed: %v", err)
	}
}

func chainConfigPath() string {
	value := strings.TrimSpace(os.Getenv("PROTOCOL_CHAINS_CONFIG_PATH"))
	if value == "" {
		return defaultChainsPath
	}
	return value
}

func loadAllowedChains(configPath string) (map[int]struct{}, error) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var chains []chainConfig
	if err := json.Unmarshal(content, &chains); err != nil {
		return nil, err
	}
	if len(chains) == 0 {
		return nil, errors.New("chain config is empty")
	}
	allowed := make(map[int]struct{}, len(chains))
	for _, chain := range chains {
		if chain.Key == "" || chain.ChainID <= 0 || chain.Name == "" || chain.ExplorerBaseURL == "" {
			return nil, fmt.Errorf("invalid chain config entry: %+v", chain)
		}
		if _, ok := allowed[chain.ChainID]; ok {
			return nil, fmt.Errorf("duplicate chain id in chain config: %d", chain.ChainID)
		}
		allowed[chain.ChainID] = struct{}{}
	}
	return allowed, nil
}

func requiredEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}

func newS3Client(ctx context.Context) (*s3.Client, error) {
	region := requiredEnv("REGION")
	endpoint := requiredEnv("ENDPOINT")
	accessKeyID := requiredEnv("ACCESS_KEY_ID")
	secretAccessKey := requiredEnv("SECRET_ACCESS_KEY")

	cfg := aws.Config{
		Region: region,
		Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{
				AccessKeyID:     accessKeyID,
				SecretAccessKey: secretAccessKey,
			}, nil
		}),
	}

	return s3.NewFromConfig(cfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(endpoint)
		options.UsePathStyle = true
	}), nil
}

func (s server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if hasRequestBody(r) {
		writeJSON(w, http.StatusBadRequest, `{"error":"request body not allowed"}`+"\n", "no-store")
		return
	}

	if r.URL.Path == "/ready" {
		s.handleReady(w, r)
		return
	}

	resolved, ok := resolveRoute(r.URL.Path, s.allowedChains)
	if !ok {
		writeJSON(w, http.StatusNotFound, `{"error":"not found"}`+"\n", "no-store")
		return
	}

	if r.Method == http.MethodOptions {
		setCORSHeaders(w)
		w.Header().Set("Access-Control-Allow-Headers", "Accept")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		writeJSON(w, http.StatusMethodNotAllowed, `{"error":"method not allowed"}`+"\n", "no-store")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	output, err := s.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(resolved.key),
	})
	if err != nil {
		if isMissingObject(err) {
			writeJSON(w, http.StatusNotFound, `{"error":"snapshot not found"}`+"\n", "no-store")
			return
		}
		writeJSON(w, http.StatusBadGateway, `{"error":"snapshot fetch failed"}`+"\n", "no-store")
		return
	}
	defer output.Body.Close()

	setObjectHeaders(w, resolved, output)
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := io.Copy(w, output.Body); err != nil {
		log.Printf("failed to stream %s: %v", resolved.key, err)
	}
}

func hasRequestBody(r *http.Request) bool {
	return r.ContentLength > 0 || len(r.TransferEncoding) > 0
}

func (s server) handleReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, `{"error":"method not allowed"}`+"\n", "no-store")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	_, err := s.s3.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(bucketRoot + "/manifest.json"),
	})
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, `{"ok":false,"error":"manifest not accessible"}`+"\n", "no-store")
		return
	}

	writeJSON(w, http.StatusOK, `{"ok":true}`+"\n", "no-store")
}

func resolveRoute(path string, allowedChains map[int]struct{}) (route, bool) {
	switch path {
	case "/", "/v1/", "/v1/index.html":
		return route{
			key:          bucketRoot + "/index.html",
			contentType:  "text/html; charset=utf-8",
			cacheControl: "public, s-maxage=300, stale-while-revalidate=3600",
		}, true
	case "/robots.txt":
		return route{
			key:          "robots.txt",
			contentType:  "text/plain; charset=utf-8",
			cacheControl: "public, s-maxage=300, stale-while-revalidate=3600",
		}, true
	case "/sitemap.xml":
		return route{
			key:          "sitemap.xml",
			contentType:  "application/xml",
			cacheControl: "public, s-maxage=300, stale-while-revalidate=3600",
		}, true
	case "/v1/manifest.json":
		return route{
			key:          bucketRoot + "/manifest.json",
			contentType:  "application/json",
			cacheControl: "public, s-maxage=300, stale-while-revalidate=3600",
		}, true
	case "/v1/schemas/manifest-v1.schema.json":
		return route{
			key:          bucketRoot + "/schemas/manifest-v1.schema.json",
			contentType:  "application/schema+json",
			cacheControl: "public, max-age=86400, immutable",
		}, true
	case "/v1/schemas/protocol-snapshot-v1.schema.json":
		return route{
			key:          bucketRoot + "/schemas/protocol-snapshot-v1.schema.json",
			contentType:  "application/schema+json",
			cacheControl: "public, max-age=86400, immutable",
		}, true
	}

	const prefix = "/v1/chain/"
	const suffix = "/protocol.json"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return route{}, false
	}

	chainIDText := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if strings.Contains(chainIDText, "/") {
		return route{}, false
	}

	chainID, err := strconv.Atoi(chainIDText)
	if err != nil {
		return route{}, false
	}
	if _, ok := allowedChains[chainID]; !ok {
		return route{}, false
	}

	return route{
		key:          fmt.Sprintf("%s/chain/%d/protocol.json", bucketRoot, chainID),
		contentType:  "application/json",
		cacheControl: "public, s-maxage=3600, stale-while-revalidate=86400",
	}, true
}

func setObjectHeaders(w http.ResponseWriter, resolved route, output *s3.GetObjectOutput) {
	setCORSHeaders(w)
	w.Header().Set("Content-Type", resolved.contentType)
	w.Header().Set("Cache-Control", resolved.cacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if output.ETag != nil {
		w.Header().Set("ETag", *output.ETag)
	}
	if output.LastModified != nil {
		w.Header().Set("Last-Modified", output.LastModified.UTC().Format(http.TimeFormat))
	}
	if output.ContentLength != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(*output.ContentLength, 10))
	}
}

func writeJSON(w http.ResponseWriter, status int, body string, cacheControl string) {
	setCORSHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", corsAllowOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD")
}

func isMissingObject(err error) bool {
	message := err.Error()
	return strings.Contains(message, "NoSuchKey") ||
		strings.Contains(message, "NotFound") ||
		strings.Contains(message, "404")
}
