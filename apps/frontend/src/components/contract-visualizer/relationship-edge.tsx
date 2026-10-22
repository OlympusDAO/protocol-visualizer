import { BaseEdge, type EdgeProps } from "reactflow";
import { getRelationshipCurve } from "./graph";

/** Curves avoid shared orthogonal trunks; parallel relationships get separate lanes. */
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
