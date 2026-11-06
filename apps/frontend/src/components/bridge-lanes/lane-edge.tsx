import { BaseEdge, type EdgeProps } from "reactflow";
import { getBridgeLaneCurve } from "./model";
export function BridgeLaneEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  ...props
}: EdgeProps<{ offset: number }>) {
  return (
    <BaseEdge
      {...props}
      {...getBridgeLaneCurve(
        sourceX,
        sourceY,
        targetX,
        targetY,
        data?.offset ?? 0
      )}
    />
  );
}
