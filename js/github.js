/* GitHub 불러오기·발행 (REST API, fine-grained 토큰: 해당 저장소 Contents 읽기/쓰기)
   발행 = 바뀐 파일만 하나의 커밋으로: blob → tree → commit → ref 업데이트 (Git Data API) */
const API = 'https://api.github.com';
const KEY = 'dameum_ar_admin:github';

export function loadSettings() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) return { token: v.token || '', repo: v.repo || '', branch: v.branch || 'main' }; } catch (_) {}
  return { token: '', repo: '', branch: 'main' };
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify({ token: s.token || '', repo: s.repo || '', branch: s.branch || 'main' })); } catch (_) {} }
export function clearSettings() { try { localStorage.removeItem(KEY); } catch (_) {} }
export const validRepo = (r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test((r || '').trim());

export function siteUrl(repo) {
  const [owner, name] = (repo || '').split('/');
  if (!owner || !name) return '';
  if (name.toLowerCase() === (owner + '.github.io').toLowerCase()) return `https://${name}/`;
  return `https://${owner}.github.io/${name}/`;
}

export class GHError extends Error {
  constructor(status, message) { super(message || ('GitHub ' + status)); this.status = status; }
}

/* 오류별 안내 (명세 §4.6) */
export function errorInfo(err) {
  const s = err && err.status;
  if (s === 401 || s === 403) return { title: '접근 키를 확인해 주세요', msg: '토큰이 만료됐거나 이 저장소의 Contents 쓰기 권한이 없습니다. 발행 설정에서 토큰을 확인해 주세요.', retry: false };
  if (s === 404) return { title: '저장소·브랜치를 확인해 주세요', msg: '입력한 저장소나 브랜치를 찾을 수 없습니다.', retry: false };
  if (s === 409 || s === 422) return { title: '사이트가 그사이 바뀌었습니다', msg: '사이트가 그사이 바뀌었습니다. 불러온 뒤 다시 발행해 주세요.', retry: false };
  if (!s) return { title: '네트워크 오류', msg: '인터넷 연결을 확인한 뒤 다시 시도해 주세요. 편집 내용은 그대로 남아 있습니다.', retry: true };
  return { title: '발행하지 못했습니다', msg: `GitHub 응답 ${s}. 잠시 후 다시 시도해 주세요. 편집 내용은 그대로 남아 있습니다.`, retry: true };
}

export class GitHub {
  constructor({ token, repo, branch }) {
    this.token = (token || '').trim();
    this.repo = (repo || '').trim();
    this.branch = (branch || 'main').trim() || 'main';
  }
  async req(method, path, body, accept) {
    let r;
    try {
      r = await fetch(API + '/repos/' + this.repo + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + this.token,
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch (e) { throw new GHError(0, 'network'); }
    if (!r.ok) throw new GHError(r.status, await r.text().catch(() => ''));
    if (accept && accept.includes('raw')) return r.arrayBuffer();
    return r.status === 204 ? null : r.json();
  }
  /* 연결 확인: 저장소 + 쓰기 권한 + 브랜치 */
  async check() {
    const repo = await this.req('GET', '');
    if (repo.permissions && repo.permissions.push === false) throw new GHError(403, 'no push');
    await this.head();
    return repo;
  }
  async head() {
    const ref = await this.req('GET', '/git/ref/heads/' + encodeURIComponent(this.branch));
    const commit = await this.req('GET', '/git/commits/' + ref.object.sha);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }
  async tree(treeSha) {
    const t = await this.req('GET', '/git/trees/' + treeSha + '?recursive=1');
    const map = new Map();
    (t.tree || []).forEach((e) => { if (e.type === 'blob') map.set(e.path, e.sha); });
    return map;
  }
  blobRaw(sha) { return this.req('GET', '/git/blobs/' + sha, null, 'application/vnd.github.raw'); }
  async createBlob(blob) {
    const b64 = await toBase64(blob);
    const r = await this.req('POST', '/git/blobs', { content: b64, encoding: 'base64' });
    return r.sha;
  }
  async createTree(baseTree, entries) { return (await this.req('POST', '/git/trees', { base_tree: baseTree, tree: entries })).sha; }
  async createCommit(message, tree, parent) { return (await this.req('POST', '/git/commits', { message, tree, parents: [parent] })).sha; }
  updateRef(sha) { return this.req('PATCH', '/git/refs/heads/' + encodeURIComponent(this.branch), { sha, force: false }); }

  /* 요청 묶음 만들기 (실제 호출 없이 무엇을 올리고 지울지 계산) */
  static plan(local, remote, cleanPrefixes, keepPaths) {
    // local: [{path, sha, blob}] , remote: Map(path→sha)
    const upload = local.filter((f) => remote.get(f.path) !== f.sha);
    const keep = new Set([...(keepPaths || []), ...local.map((f) => f.path)]);
    const remove = [...remote.keys()].filter((p) => cleanPrefixes.some((pre) => p.startsWith(pre)) && !keep.has(p));
    return { upload, remove };
  }

  /* v3.7: 파일 하나만 커밋(다른 파일은 그대로) — 암호화한 접근 키 보관용 */
  async putOne(path, blob, message) {
    const h = await this.head();
    const sha = await this.createBlob(blob);
    const tree = await this.createTree(h.treeSha, [{ path, mode: '100644', type: 'blob', sha }]);
    const commit = await this.createCommit(message, tree, h.commitSha);
    await this.updateRef(commit);
    return commit;
  }

  /* 발행: onProgress(0~1) */
  async publish(local, message, cleanPrefixes, keepPaths, onProgress = () => {}) {
    const h = await this.head();
    const remote = await this.tree(h.treeSha);
    const { upload, remove } = GitHub.plan(local, remote, cleanPrefixes, keepPaths);
    const entries = [];
    let done = 0;
    for (const f of upload) {
      const sha = await this.createBlob(f.blob);
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha });
      done++;
      onProgress(done / (upload.length + 1));
    }
    remove.forEach((p) => entries.push({ path: p, mode: '100644', type: 'blob', sha: null }));
    if (!entries.length) { onProgress(1); return { commit: null, upload: [], remove: [] }; }
    const tree = await this.createTree(h.treeSha, entries);
    const commit = await this.createCommit(message, tree, h.commitSha);
    await this.updateRef(commit);
    onProgress(1);
    return { commit, upload: upload.map((f) => f.path), remove };
  }
}

/* git blob sha = SHA-1("blob <크기>\0" + 내용) */
export async function gitBlobSha(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const head = new TextEncoder().encode('blob ' + buf.length + '\0');
  const all = new Uint8Array(head.length + buf.length);
  all.set(head); all.set(buf, head.length);
  const d = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
