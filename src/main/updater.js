const { execFile } = require('node:child_process');
const path = require('node:path');

const PROJECT_DIR = path.join(__dirname, '../..');

/**
 * Git-/npm-Aufrufe für das In-App-Update.
 *
 * Bewusst execFile statt exec: Argumente werden als Array übergeben und nie
 * von einer Shell interpretiert. Vorher wurden Projektpfad und
 * `process.env.USER` in einen Shell-String interpoliert.
 */
function run(command, args, { timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: PROJECT_DIR, timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Prüft, ob der Remote-Branch Commits enthält, die lokal fehlen.
 *
 * Der alte Code rief `git fetch && git status -uno` ohne cwd auf und erbte
 * damit das Arbeitsverzeichnis des Electron-Prozesses - das ist nicht
 * zwingend das Repository.
 */
async function checkForUpdate() {
  await run('git', ['fetch', '--quiet']);

  let upstream;
  try {
    ({ stdout: upstream } = await run('git', [
      'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'
    ]));
  } catch (error) {
    // Kein Upstream: typischerweise ein lokaler Arbeitsbranch. Kein Fehlerfall,
    // es gibt nur nichts zu aktualisieren.
    const { stdout: branch } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return {
      updateAvailable: false,
      behind: 0,
      ahead: 0,
      currentCommit: null,
      upstream: null,
      note: `Branch "${branch.trim()}" hat keinen Upstream - Updates sind hier nicht verfügbar.`
    };
  }

  const { stdout: counts } = await run('git', [
    'rev-list', '--left-right', '--count', `HEAD...${upstream.trim()}`
  ]);

  const [ahead, behind] = counts.trim().split(/\s+/).map(Number);
  const { stdout: current } = await run('git', ['rev-parse', '--short', 'HEAD']);

  return {
    updateAvailable: behind > 0,
    behind,
    ahead,
    currentCommit: current.trim(),
    upstream: upstream.trim()
  };
}

/**
 * Holt die Änderungen und installiert die Abhängigkeiten.
 *
 * Zwei bewusste Verhaltensänderungen gegenüber vorher:
 *
 *  - `git pull --ff-only` statt stash + pull. Lokale Änderungen wurden bisher
 *    stillschweigend weggestasht; wer das nicht wusste, hat sie nie
 *    wiedergefunden. Jetzt bricht das Update ab und sagt, was los ist.
 *  - `npm ci --omit=dev` statt `npm install`. `npm install` schreibt das
 *    Lockfile bei jeder Gelegenheit um - genau dadurch war es kaputt.
 */
async function executeUpdate() {
  const status = await run('git', ['status', '--porcelain']);
  if (status.stdout.trim()) {
    const error = new Error(
      'Es gibt lokale Änderungen im Projektverzeichnis. Das Update wurde abgebrochen, ' +
      'damit nichts verloren geht. Bitte die Änderungen sichern oder verwerfen und erneut versuchen.'
    );
    error.code = 'DIRTY_WORKING_TREE';
    error.details = status.stdout.trim();
    throw error;
  }

  const pull = await run('git', ['pull', '--ff-only']);
  const install = await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    timeout: 900000
  });

  return { log: `${pull.stdout}\n${install.stdout}`.trim() };
}

/**
 * Startet die Anwendung neu. pm2 ist der Normalfall auf dem Pi; ohne pm2
 * beendet sich der Prozess und überlässt den Neustart systemd.
 */
function restart(onFallback) {
  execFile('pm2', ['restart', 'all'], { timeout: 60000 }, (error) => {
    if (error) onFallback(error);
  });
}

module.exports = { checkForUpdate, executeUpdate, restart, PROJECT_DIR };
