import { useEffect, useMemo } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AwsModel } from '../../aws/model';
import { Icon } from '../Icon';
import AwsIcon from './AwsIcon';
import { awsLayout, type GroupData, type HeaderData, type ResData } from './awsLayout';

// Hidden handles on all four sides (as source and target) so each edge can leave/enter on the side facing its peer.
const sides = [['top', Position.Top], ['bottom', Position.Bottom], ['left', Position.Left], ['right', Position.Right]] as const;
const handles = <>{sides.map(([id, pos]) => <Handle key={`s-${id}`} id={id} type="source" position={pos} className="hidden-handle"/>)}{sides.map(([id, pos]) => <Handle key={`t-${id}`} id={id} type="target" position={pos} className="hidden-handle"/>)}</>;
function Res({ data }: NodeProps<Node<ResData>>) {
  return <div className={`aws-res tone-${data.tone} ${data.hot ? 'hot' : ''}`} title={[data.label, data.sub].filter(Boolean).join('\n')}>{handles}{data.awsIcon ? <AwsIcon kind={data.awsIcon} size={28}/> : <Icon name={data.icon} size={18}/>}<div><strong>{data.label}</strong>{data.sub && <small>{data.sub}</small>}</div></div>;
}
function Group({ data }: NodeProps<Node<GroupData>>) {
  return <div className={`aws-group tone-${data.tone} ${data.hot ? 'hot' : ''}`}>{handles}</div>;
}
/** Group label as its own node, stacked above edges so lines never run over the text. */
function Header({ data }: NodeProps<Node<HeaderData>>) {
  const icon = data.tone === 'vpc' ? 'vpc' : data.tone === 'public' ? 'publicSubnet' : data.tone === 'private' ? 'privateSubnet' : undefined;
  return <div className={`aws-group-label tone-${data.tone} ${icon ? 'with-aws-icon' : ''} ${data.hot ? 'hot' : ''}`} title={[data.label, data.sub].filter(Boolean).join('\n')}>{icon && <AwsIcon kind={icon} size={24}/>}<strong>{data.label}</strong>{data.sub && <small>{data.sub}</small>}</div>;
}
// 'area' (not React Flow's built-in 'group' type, which adds its own padding and border).
const nodeTypes = { res: Res, area: Group, header: Header };

function FitDiagram({ nodeIds }: { nodeIds: string }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => { if (initialized) void fitView({ padding: 0.08 }); }, [initialized, nodeIds, fitView]);
  return null;
}

export default function AwsDiagram({ model, highlight = [], onSelect }: { model: AwsModel; highlight?: string[]; onSelect?: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => awsLayout(model, new Set(highlight)), [model, highlight.join(',')]);
  return <div className="aws-diagram"><ReactFlowProvider><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.15} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false}
    onNodeClick={(_, n) => onSelect?.(n.type === 'header' ? (n.data as HeaderData).group : n.id)} proOptions={{ hideAttribution: false }}>
    <FitDiagram nodeIds={nodes.map(n => n.id).join(',')}/><Background color="#d4ddd8" gap={22} size={1} variant={BackgroundVariant.Dots}/><Controls showInteractive={false}/></ReactFlow></ReactFlowProvider></div>;
}
