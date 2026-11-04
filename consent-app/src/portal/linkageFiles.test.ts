import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { eegManifest, EEG_TEMPLATE, myselfIdentifiers, myselfParticipants, parseDelimited, parseXlsx } from './linkageFiles';

describe('EEG manifest', () => {
  it('reads the template, headings matched loosely, dates as written (dd/mm/yyyy)', () => {
    const m = eegManifest(parseDelimited(EEG_TEMPLATE));
    expect(m.problem).toBeNull();
    expect(m.rows[0]).toMatchObject({ recordingId: 'EEG-0001', firstName: 'Amara', lastName: 'Ahmed', dob: '04/05/2012', sex: 'F', recordingDate: '12/11/2026', site: 'GSAL', task: 'rest' });
    const loose = eegManifest(parseDelimited('Recording ID;Forename;Surname;DOB\nR1;"Zoë";"O\'Neill, Bárta";31/01/2010\n'));
    expect(loose.rows[0]).toMatchObject({ recordingId: 'R1', firstName: 'Zoë', lastName: "O'Neill, Bárta", dob: '31/01/2010', sex: '' });
  });
  it('says which columns are missing', () => {
    expect(eegManifest(parseDelimited('recording_id,first_name\nR1,A\n')).problem).toMatch(/last_name, date_of_birth/);
  });
  it('reads an Excel manifest, a date cell as dd/mm/yyyy', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><t>recording_id</t></si><si><t>first_name</t></si><si><t>last_name</t></si><si><t>date_of_birth</t></si><si><t>R7</t></si><si><t>Ben</t></si><si><t>Brook</t></si></sst>');
    zip.file('xl/styles.xml', '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" s="1"><v>40858</v></c></row></sheetData></worksheet>');
    const m = eegManifest(await parseXlsx(await zip.generateAsync({ type: 'uint8array' })));
    expect(m.rows[0]).toMatchObject({ recordingId: 'R7', firstName: 'Ben', lastName: 'Brook', dob: '11/11/2011' });
  });
});

describe('MySelf files', () => {
  it('participants.tsv and the identifiers CSV', () => {
    expect(myselfParticipants(parseDelimited('participant_id\tsites\tfirst_seen\nsub-PAAA\tGSAL\t2026-11-10\n')).rows[0]).toEqual({ code: 'sub-PAAA', sites: 'GSAL', firstSeen: '2026-11-10' });
    const ids = myselfIdentifiers(parseDelimited('participant_id,given_name,family_name,date_of_birth,home_address,upn\nPAAA,Amara,Ahmed,2012-05-04,"{""postcode"":""ls6 1ab""}",A123456789012\n'));
    expect(ids.rows[0]).toEqual({ code: 'PAAA', givenName: 'Amara', familyName: 'Ahmed', dob: '2012-05-04', postcode: 'LS61AB', upn: 'A123456789012' });
    expect(myselfParticipants(parseDelimited('a,b\n1,2\n')).problem).toMatch(/participant_id/);
  });
});
