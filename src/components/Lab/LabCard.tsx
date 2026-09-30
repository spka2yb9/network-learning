import { Link } from 'react-router-dom';
import { lab as controller } from '../../application/LabController';
import { labPath } from '../../labs';
import type { Lab } from '../../labs/types';
import { Icon } from '../Icon';

const kindLabel = { guided: 'Guided', challenge: 'Challenge', troubleshooting: 'Troubleshooting', mastery: 'Mastery', capstone: 'Capstone' } as const;
const workspaceLabel = { network: 'Network', aws: 'AWS', terraform: 'Terraform', capture: 'Capture' } as const;
export default function LabCard({ lab }: { lab: Lab }) {
  const done = controller.completed.has(`lab:${lab.id}`);
  return <Link to={labPath(lab)} className={`lab-card kind-${lab.kind} ${done ? 'done' : ''}`}>
    <div className="lab-card-top"><span className="tag">{kindLabel[lab.kind]}</span><span className="tag ghost">{workspaceLabel[lab.workspace]}</span><span className="lab-card-time"><Icon name="clock" size={13}/>{lab.minutes}分</span>{done && <span className="done-badge"><Icon name="check" size={13}/>完了</span>}</div>
    <h3>{lab.title}</h3><p>{lab.mission}</p><span className="lab-card-open">ラボを開く<Icon name="arrow" size={14}/></span>
  </Link>;
}
