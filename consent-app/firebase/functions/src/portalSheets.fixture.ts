import type { SheetData, SheetPerson } from './portalSheets.js';

/**
 * A made-up portal for the sheet's tests and its sample rendering (nobody
 * real): six research assistants, two research leads, two schools, and
 * visits either side of Thursday 5 November 2026.
 */

const person = (p: Partial<SheetPerson> & Pick<SheetPerson, 'uid' | 'name'>): SheetPerson => ({
  email: `${p.uid}@example.ac.uk`,
  phone: '',
  role: 'ra',
  status: 'active',
  level: 2,
  capabilities: ['eeg'],
  tags: [],
  dbs: 'confirmed',
  dbsApplied: false,
  dbsAppliedOn: null,
  signOff: 'signed-off',
  signOffBy: 'Sam Lead',
  signOffAt: '2026-10-20T10:00:00.000Z',
  approvals: [],
  training: 2,
  pilots: 1,
  daysAttended: 0,
  ready: true,
  reasons: [],
  reasonsBySchool: {},
  joined: '2026-10-01T09:00:00.000Z',
  ...p,
});

const gsal = (at: string) => ({ schoolId: 'GSAL', schoolName: 'Grammar School at Leeds', at, byName: 'Sam Lead' });

export function sampleSheetData(): SheetData {
  const day = (date: string, extra: Record<string, unknown> = {}) => ({ date, on: true, start: '08:30', end: '15:00', ...extra });
  return {
    syncedAt: '2026-11-05T14:05:00.000Z',
    today: '2026-11-05',
    portalUrl: 'https://myphonemybrain.com/portal/',
    people: [
      person({ uid: 'ra1', name: 'Amira Khan', level: 3, capabilities: ['eeg', 'copro'], approvals: [gsal('2026-10-28T12:00:00.000Z')], daysAttended: 1 }),
      person({ uid: 'ra2', name: 'Ben Okafor', capabilities: ['eeg'], approvals: [gsal('2026-10-28T12:00:00.000Z')] }),
      person({ uid: 'ra3', name: 'Chloe Price', capabilities: ['copro'], dbs: 'processing', dbsApplied: true, dbsAppliedOn: '2026-10-30', ready: false, reasons: ['Enhanced DBS certificate: not uploaded'], reasonsBySchool: { GSAL: ['Enhanced DBS certificate: not uploaded', 'Not yet approved by Grammar School at Leeds'] } }),
      person({ uid: 'ra4', name: 'Dev Patel', level: 1, capabilities: ['eeg'], signOff: 'assess', approvals: [gsal('2026-11-02T09:00:00.000Z')] }),
      person({ uid: 'ra5', name: 'Ella Brown', capabilities: ['eeg', 'copro'], dbs: 'starting', signOff: 'not-trained', ready: false, reasons: ['Enhanced DBS certificate: not uploaded', 'Training: 0 of 2'], reasonsBySchool: { GSAL: ['Enhanced DBS certificate: not uploaded', 'Training: 0 of 2', 'Not yet approved by Grammar School at Leeds'] }, training: 0, pilots: 0 }),
      person({ uid: 'ra6', name: 'Finn Murphy', capabilities: ['eeg'], dbs: 'expired', ready: false, reasons: ['Enhanced DBS certificate: out of date by the visit'], approvals: [gsal('2026-10-28T12:00:00.000Z')] }),
      person({ uid: 'lead1', name: 'Sam Lead', role: 'pm', level: 4, capabilities: ['lead'], approvals: [gsal('2026-10-28T12:00:00.000Z')] }),
      person({ uid: 'lead2', name: 'Riya Shah', role: 'researcher', level: 4, capabilities: ['lead'] }),
    ],
    documents: [
      { uid: 'ra1', person: 'Amira Khan', document: 'Enhanced DBS certificate', school: 'Everyone', state: 'verified', uploadedOn: '2026-10-02', checkedOn: '2026-10-03', checkedBy: 'Sam Lead', validUntil: '', issueDate: '2025-06-01', updateService: true, hasCopy: true },
      { uid: 'ra1', person: 'Amira Khan', document: 'Health form', school: 'Grammar School at Leeds', state: 'verified', uploadedOn: '2026-10-02', checkedOn: '2026-10-03', checkedBy: 'Sam Lead', validUntil: '', issueDate: '', updateService: null, hasCopy: true },
      { uid: 'ra3', person: 'Chloe Price', document: 'Safeguarding training certificate', school: 'Everyone', state: 'uploaded', uploadedOn: '2026-11-04', checkedOn: '', checkedBy: '', validUntil: '', issueDate: '', updateService: null, hasCopy: true },
    ],
    schools: [
      { id: 'GSAL', name: 'Grammar School at Leeds', short: 'GSAL', requireApproval: true, requiredDocs: ['Health form'] },
      { id: 'ALLERTON', name: 'Allerton High School', short: 'ALLERTON', requireApproval: false, requiredDocs: [] },
    ],
    visits: [
      {
        visitId: 'v-past', schoolId: 'GSAL', schoolName: 'Grammar School at Leeds', status: 'locked', location: 'Sports hall',
        days: [day('2026-11-03')], roleNeeds: { eeg: 2, copro: 0, lead: 1 },
        assignments: [
          { uid: 'ra1', status: 'confirmed', role: 'eeg', dates: ['2026-11-03'], offeredAt: '2026-10-25T10:00:00.000Z', respondedAt: '2026-10-25T12:00:00.000Z' },
          { uid: 'ra2', status: 'confirmed', role: 'eeg', dates: ['2026-11-03'], offeredAt: '2026-10-25T10:00:00.000Z', respondedAt: '2026-10-26T12:00:00.000Z' },
          { uid: 'lead1', status: 'confirmed', role: 'lead', dates: ['2026-11-03'], offeredAt: '2026-10-25T10:00:00.000Z', respondedAt: '2026-10-25T10:00:00.000Z' },
        ],
      },
      {
        visitId: 'v-next', schoolId: 'GSAL', schoolName: 'Grammar School at Leeds', status: 'staffing', location: 'Sports hall',
        days: [day('2026-11-09'), day('2026-11-10'), day('2026-11-11', { eeg: 2 }), day('2026-11-12', {}), { ...day('2026-11-13'), on: false }],
        roleNeeds: { eeg: 3, copro: 1, lead: 2 },
        assignments: [
          { uid: 'ra1', status: 'confirmed', role: 'eeg', dates: ['2026-11-09', '2026-11-10', '2026-11-11'], offeredAt: '2026-10-30T10:00:00.000Z', respondedAt: '2026-10-30T12:00:00.000Z' },
          { uid: 'ra2', status: 'confirmed', role: 'eeg', dates: ['2026-11-09', '2026-11-10'], offeredAt: '2026-10-30T10:00:00.000Z', respondedAt: '2026-10-31T12:00:00.000Z' },
          { uid: 'ra4', status: 'offered', role: 'eeg', dates: ['2026-11-09', '2026-11-11'], offeredAt: '2026-11-01T10:00:00.000Z', respondedAt: null },
          { uid: 'ra6', status: 'confirmed', role: 'eeg', dates: ['2026-11-12'], offeredAt: '2026-10-30T10:00:00.000Z', respondedAt: '2026-10-30T11:00:00.000Z' },
          { uid: 'ra3', status: 'offered', role: 'copro', dates: ['2026-11-09', '2026-11-10'], offeredAt: '2026-11-05T09:00:00.000Z', respondedAt: null },
          { uid: 'lead1', status: 'confirmed', role: 'lead', dates: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'], offeredAt: '2026-10-29T10:00:00.000Z', respondedAt: '2026-10-29T10:00:00.000Z' },
          { uid: 'lead2', status: 'confirmed', role: 'lead', dates: ['2026-11-09'], offeredAt: '2026-10-29T10:00:00.000Z', respondedAt: '2026-10-29T10:00:00.000Z' },
          { uid: 'ra5', status: 'declined', role: 'eeg', dates: ['2026-11-09'], offeredAt: '2026-10-29T10:00:00.000Z', respondedAt: '2026-10-29T18:00:00.000Z' },
        ],
      },
      {
        visitId: 'v-allerton', schoolId: 'ALLERTON', schoolName: 'Allerton High School', status: 'provisional', location: 'Library',
        days: [day('2026-11-24')], roleNeeds: { eeg: 2, copro: 1, lead: 1 }, assignments: [],
      },
      { visitId: 'v-off', schoolId: 'ALLERTON', schoolName: 'Allerton High School', status: 'cancelled', location: 'Library', days: [day('2026-11-17')], roleNeeds: { eeg: 2, copro: 0, lead: 1 }, assignments: [] },
    ],
    availability: [
      ...['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].flatMap((date) => [
        { uid: 'ra1', date, value: 'all' as const, note: '' },
        { uid: 'ra2', date, value: date === '2026-11-12' ? ('no' as const) : ('all' as const), note: '' },
        { uid: 'ra3', date, value: 'maybe' as const, note: 'Depends on a lecture' },
        { uid: 'ra4', date, value: date === '2026-11-10' ? ('am' as const) : ('all' as const), note: '' },
        { uid: 'ra5', date, value: 'pm' as const, note: '' },
        { uid: 'lead1', date, value: 'all' as const, note: '' },
        { uid: 'lead2', date, value: date === '2026-11-09' ? ('all' as const) : ('no' as const), note: '' },
      ]),
      { uid: 'ra6', date: '2026-11-12', value: 'all', note: '' },
    ],
    attendance: [{ visitId: 'v-past', uid: 'ra1', date: '2026-11-03', mark: 'attended', note: '' }],
    sessions: [{ id: 's1', kind: 'training', date: '2026-10-15', title: 'EEG set-up', role: 'eeg', attendees: ['ra1', 'ra2', 'ra4'] }],
    claims: [{ uid: 'ra5', kind: 'training', date: '2026-11-01', title: 'EEG set-up (catch-up)', status: 'waiting' }],
    mail: [{ at: '2026-11-01T10:00:00.000Z', channel: 'email', kind: 'offer', to: 'ra4@example.ac.uk', subject: 'You have been selected: Grammar School at Leeds', outcome: 'sent' }],
    audit: [
      { at: '2026-11-01T10:00:00.000Z', by: 'Sam Lead', action: 'offer', target: 'v-next', details: { uid: 'ra4', role: 'eeg' } },
      { at: '2026-11-02T10:00:00.000Z', by: 'Sam Lead', action: 'edit-document-details', target: 'doc1', details: { before: { certificateNumber: '001234567890', issueDate: '2025-06-01' }, after: { certificateNumber: '001234567891' } } },
    ],
    notes: null,
  };
}
