import { db } from '../db/database';
import { labById } from '../labs';
import { lab } from './LabController';
import { terraform } from './CloudController';

/**
 * Forget the learning record: read sections, completions, quiz / diagnosis / observation answers, and each lab's
 * workspace (a Simulation step's check mark comes from the lab's saved state). Playgrounds and saved designs stay.
 * Ends with a reload, so no controller keeps the old state in memory.
 */
export async function resetProgress() {
  terraform.flush(); await lab.save();
  // Stop saving: main.tsx saves the open lab when the page hides, which would write it back during the reload.
  lab.storageReady = false;
  try {
    await db.transaction('rw', [db.progress, db.quizzes, db.labs, db.workspaces, db.settings], () => Promise.all([
      db.progress.clear(), db.quizzes.clear(),
      db.labs.where('id').startsWith('lab:').delete(),
      // `aws:<id>` / `tf:<id>`; the playgrounds' ids are not lab ids.
      db.workspaces.filter(w => !!labById(w.id.slice(w.id.indexOf(':') + 1))).delete(),
      db.settings.where('id').startsWith('obs:').delete(),
    ]));
  } catch (error) { lab.storageReady = true; throw error; }
  location.reload();
}
