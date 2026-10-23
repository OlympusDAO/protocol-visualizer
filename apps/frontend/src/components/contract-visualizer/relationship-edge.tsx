import {
  BaseEdge,
  type EdgeProps,
  type XYPosition,
  useReactFlow,
} from "reactflow";
import { getRelationshipCurve } from "./graph";

export function RelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  data,
  ...props
}: EdgeProps<{
  laneOffset?: number;
  route?: {
    points: XYPosition[];
    labelX: number;
    labelY: number;
    sourcePosition: XYPosition;
    targetPosition: XYPosition;
  };
}>) {
  const { getNode } = useReactFlow();
  const route = data?.route;
  const samePosition = (id: string, expected: XYPosition) => {
    const position = getNode(id)?.position;
    return position?.x === expected.x && position.y === expected.y;
  };
  const curve =
    route &&
    sourceX < targetX &&
    samePosition(source, route.sourcePosition) &&
    samePosition(target, route.targetPosition)
      ? {
          path: `M ${sourceX},${sourceY} ${route.points
            .slice(1, -1)
            .map((point) => `L ${point.x},${point.y}`)
            .join(" ")} L ${targetX},${targetY}`,
          labelX: route.labelX,
          labelY: route.labelY,
        }
      : getRelationshipCurve(
          sourceX,
          sourceY,
          targetX,
          targetY,
          data?.laneOffset
        );
  return <BaseEdge {...props} {...curve} />;
}
