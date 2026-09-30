import { db, type DesignInfo, type DesignRecord } from '../db/database';
import { baseVpc, singleWeb, threeTier } from '../aws/scenarios';
import { starterFiles, threeTierFiles } from '../terraform/examples';

export const untitledDesign = (): DesignInfo => ({ name: '無題の構成' });

export const awsTemplates = {
  base: { name: '基本のVPC', description: 'VPC・メインルートテーブル・既定のSGとNACL', build: () => baseVpc() },
  web: { name: 'Webサーバー', description: 'インターネットからアクセスできるWebサーバー', build: () => singleWeb(true) },
  'three-tier': { name: '3層構成', description: '2つのAZにALB・アプリ・DBを配置', build: threeTier },
};

export const terraformTemplates = {
  starter: { name: 'VPCだけの最小構成', description: 'terraform / provider / variable / output と VPC 1つ', build: () => ({ files: starterFiles() }) },
  'three-tier': { name: '3層構成', description: '2つのAZにALB・アプリ・DB（network / security / compute に分割）', build: () => ({ files: threeTierFiles() }) },
};

/** Named snapshots are independent of the automatically saved editing draft. */
export async function saveDesign(kind: DesignRecord['kind'], info: DesignInfo, name: string, data: unknown): Promise<DesignInfo> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('構成名を入力してください。');
  // The same name updates that saved design (README: 同じ名前での保存はその保存済み構成を更新し…).
  const id = info.savedId && trimmed === info.name ? info.savedId : (await db.designs.where('kind').equals(kind).filter(r => r.name === trimmed).first())?.id ?? crypto.randomUUID();
  await db.designs.put({ id, kind, name: trimmed, template: info.template, data: structuredClone(data), updatedAt: Date.now() });
  return { ...info, name: trimmed, savedId: id, modified: false };
}

export async function deleteDesign(kind: DesignRecord['kind'], id: string) {
  await db.transaction('rw', db.designs, async () => {
    const record = await db.designs.get(id);
    if (record && record.kind !== kind) throw new Error('この画面では削除できない構成です。');
    await db.designs.delete(id);
  });
}
