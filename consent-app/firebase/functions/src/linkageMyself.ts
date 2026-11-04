import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Reading MySelf (4 November 2026), behind one interface so the emulator can
 * stand in a fake.
 *
 * MySelf keeps two Firebase projects (MySelf docs/13-firebase.md): the
 * research project (myself-research: sittings, no names) and the identity
 * project (myself-identity: each participant code's name, date of birth,
 * address and UPN, and the claim each sitting made). The portal's functions
 * run as myphone-mybrain's compute service account; once that account has
 * Cloud Datastore Viewer on both (firebase/scripts/grant-myself-read.sh) they
 * read, never write:
 *   research  studies/{study}/sessions   sessionId, studyCode (site), releaseKey, startedAt
 *   identity  studies/{study}/claims     sessionId -> claimedCode
 *   identity  studies/{study}/participants  participantCode, upn
 * Names (givenName, familyName, dateOfBirth, homeAddress.postcode) are read
 * only into memory: for a matching run, and for a reviewer who asks to see
 * them. They are never written here.
 */

export interface MyselfSitting {
  date: string;
  release: string;
  site: string;
}
export interface MyselfParticipant {
  code: string;
  sites: string[];
  sittings: MyselfSitting[];
  upn: string | null;
}
export interface MyselfNames {
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  postcode: string;
}
export interface PartStatus {
  ok: boolean;
  error: string;
}
export interface MyselfStatus {
  mode: 'live' | 'fake';
  researchProject: string;
  identityProject: string;
  study: string;
  research: PartStatus;
  identity: PartStatus;
}
export interface MyselfSource {
  status(): Promise<MyselfStatus>;
  participants(): Promise<MyselfParticipant[]>;
  /** Names for the codes asked (all when none given). */
  names(codes?: string[]): Promise<Map<string, MyselfNames>>;
}

export const MYSELF_RESEARCH_PROJECT = process.env.MYSELF_RESEARCH_PROJECT || 'myself-research';
export const MYSELF_IDENTITY_PROJECT = process.env.MYSELF_IDENTITY_PROJECT || 'myself-identity';
export const MYSELF_STUDY = process.env.MYSELF_STUDY || 'ybm';

/** The letters a MySelf study code opens with are the site (MySelf packages/store/src/ingest.ts). */
export const siteOfCode = (studyCode: unknown) => /^([A-Za-z]{2,})/.exec(String(studyCode ?? ''))?.[1]?.toUpperCase() ?? '';

const errorText = (e: unknown) => {
  const m = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  if (/PERMISSION_DENIED|permission/i.test(m)) return 'Permission denied: the portal’s service account cannot read this project yet (run grant-myself-read.sh).';
  if (/NOT_FOUND|not found|does not exist/i.test(m)) return 'Not found: the project or its database does not exist yet.';
  return m;
};

function appFor(projectId: string): App {
  const name = `myself-${projectId}`;
  return getApps().find((a) => a.name === name) ?? initializeApp({ projectId }, name);
}

/** Joins sittings to the codes their claims named. Pure, for the tests. */
export function assemble(codes: { code: string; upn: string | null }[], claims: { sessionId: string; code: string }[], sessions: { sessionId: string; studyCode: string; releaseKey: string; startedAt: string; quarantined?: boolean }[]): MyselfParticipant[] {
  const sessionBy = new Map(sessions.filter((s) => !s.quarantined).map((s) => [s.sessionId, s]));
  const out = new Map<string, MyselfParticipant>(codes.map((c) => [c.code, { code: c.code, sites: [], sittings: [], upn: c.upn }]));
  for (const c of claims) {
    const s = sessionBy.get(c.sessionId);
    const p = out.get(c.code);
    if (!s || !p) continue;
    p.sittings.push({ date: String(s.startedAt).slice(0, 10), release: s.releaseKey, site: siteOfCode(s.studyCode) });
  }
  for (const p of out.values()) {
    p.sittings.sort((a, b) => a.date.localeCompare(b.date));
    p.sites = [...new Set(p.sittings.map((s) => s.site).filter(Boolean))];
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export class LiveMyself implements MyselfSource {
  constructor(
    private readonly researchProject = MYSELF_RESEARCH_PROJECT,
    private readonly identityProject = MYSELF_IDENTITY_PROJECT,
    private readonly study = MYSELF_STUDY,
  ) {}
  private research(): Firestore {
    return getFirestore(appFor(this.researchProject));
  }
  private identity(): Firestore {
    return getFirestore(appFor(this.identityProject));
  }
  async status(): Promise<MyselfStatus> {
    const probe = async (db: () => Firestore, path: string): Promise<PartStatus> => {
      try {
        await db().collection(path).limit(1).select().get();
        return { ok: true, error: '' };
      } catch (e) {
        return { ok: false, error: errorText(e) };
      }
    };
    const [research, identity] = await Promise.all([probe(() => this.research(), `studies/${this.study}/sessions`), probe(() => this.identity(), `studies/${this.study}/participants`)]);
    return { mode: 'live', researchProject: this.researchProject, identityProject: this.identityProject, study: this.study, research, identity };
  }
  async participants(): Promise<MyselfParticipant[]> {
    const id = this.identity();
    const [codesSnap, claimsSnap, sessionsSnap] = await Promise.all([
      id.collection(`studies/${this.study}/participants`).select('participantCode', 'upn').get(),
      id.collection(`studies/${this.study}/claims`).select('sessionId', 'claimedCode').get(),
      this.research().collection(`studies/${this.study}/sessions`).select('sessionId', 'studyCode', 'releaseKey', 'startedAt', 'quarantined').get(),
    ]);
    return assemble(
      codesSnap.docs.map((d) => ({ code: String(d.data().participantCode ?? d.id), upn: typeof d.data().upn === 'string' ? d.data().upn : null })),
      claimsSnap.docs.map((d) => ({ sessionId: String(d.data().sessionId ?? d.id), code: String(d.data().claimedCode ?? '') })),
      sessionsSnap.docs.map((d) => ({ sessionId: String(d.data().sessionId ?? d.id), studyCode: String(d.data().studyCode ?? ''), releaseKey: String(d.data().releaseKey ?? ''), startedAt: String(d.data().startedAt ?? ''), quarantined: d.data().quarantined === true })),
    );
  }
  async names(codes?: string[]): Promise<Map<string, MyselfNames>> {
    const col = this.identity().collection(`studies/${this.study}/participants`);
    const docs = codes ? (await Promise.all(codes.map((c) => col.doc(c).get()))).filter((d) => d.exists) : (await col.select('participantCode', 'givenName', 'familyName', 'dateOfBirth', 'homeAddress').get()).docs;
    const out = new Map<string, MyselfNames>();
    for (const d of docs) {
      const x = d.data() ?? {};
      out.set(String(x.participantCode ?? d.id), { givenName: String(x.givenName ?? ''), familyName: String(x.familyName ?? ''), dateOfBirth: typeof x.dateOfBirth === 'string' ? x.dateOfBirth.slice(0, 10) : null, postcode: String((x.homeAddress as { postcode?: unknown } | null)?.postcode ?? '') });
    }
    return out;
  }
}

/**
 * The emulator's MySelf: the documents in linkFakeMyself (one a participant:
 * code, sites, sittings, upn, givenName, familyName, dateOfBirth, postcode),
 * which the end-to-end test writes. Never used outside the emulator.
 */
export class FakeMyself implements MyselfSource {
  constructor(private readonly db: Firestore) {}
  async status(): Promise<MyselfStatus> {
    const any = await this.db.collection('linkFakeMyself').limit(1).get();
    const part = any.empty ? { ok: false, error: 'Permission denied: the portal’s service account cannot read this project yet (run grant-myself-read.sh).' } : { ok: true, error: '' };
    return { mode: 'fake', researchProject: 'fake-myself-research', identityProject: 'fake-myself-identity', study: 'ybm', research: part, identity: part };
  }
  async participants(): Promise<MyselfParticipant[]> {
    return (await this.db.collection('linkFakeMyself').get()).docs.map((d) => {
      const x = d.data();
      const sittings = (Array.isArray(x.sittings) ? x.sittings : []) as MyselfSitting[];
      return { code: d.id, sites: [...new Set(sittings.map((s) => s.site).filter(Boolean))], sittings, upn: typeof x.upn === 'string' ? x.upn : null };
    });
  }
  async names(codes?: string[]): Promise<Map<string, MyselfNames>> {
    const out = new Map<string, MyselfNames>();
    for (const d of (await this.db.collection('linkFakeMyself').get()).docs) {
      if (codes && !codes.includes(d.id)) continue;
      const x = d.data();
      out.set(d.id, { givenName: String(x.givenName ?? ''), familyName: String(x.familyName ?? ''), dateOfBirth: typeof x.dateOfBirth === 'string' ? x.dateOfBirth : null, postcode: String(x.postcode ?? '') });
    }
    return out;
  }
}

export function myselfSource(db: Firestore): MyselfSource {
  return process.env.FUNCTIONS_EMULATOR === 'true' ? new FakeMyself(db) : new LiveMyself();
}
