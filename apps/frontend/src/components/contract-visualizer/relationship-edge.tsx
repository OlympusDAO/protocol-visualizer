import { BaseEdge, type EdgeProps } from "reactflow";
import { getRelationshipCurve } from "./graph";

export function RelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  ...props
}: EdgeProps<{ laneOffset?: number }>) {
  const curve = getRelationshipCurve(
    sourceX,
    sourceY,
    targetX,
    targetY,
    data?.laneOffset
  );
  return <BaseEdge {...props} {...curve} />;
}
