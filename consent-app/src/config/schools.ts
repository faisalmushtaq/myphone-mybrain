import list from '../../../_data/schools.json';

/**
 * Participating schools, from the website's _data/schools.json. The same
 * list makes each school's page for parents (myphonemybrain.com/<slug>/,
 * built by _plugins/school_pages.rb), whose button opens this form with
 * ?school=<slug> so the school is already chosen. To add a school, add one
 * line there; the id is what the study database records.
 */
export interface School {
  id: string;
  /** The school's web address on the site: myphonemybrain.com/<slug>/. */
  slug: string;
  name: string;
  area: string;
}

export const schools: School[] = list;

/** Special value for "My school is not in the list". */
export const OTHER_SCHOOL_ID = 'other';

/** The school a link names (?school=gsal), in any capitals. */
export function schoolBySlug(slug: string | null | undefined): School | undefined {
  const s = (slug ?? '').trim().toLowerCase();
  return s ? schools.find((x) => x.slug === s) : undefined;
}

/** The school named by this page's address, if any. */
export function schoolFromLink(): School | undefined {
  try {
    return schoolBySlug(new URLSearchParams(window.location.search).get('school'));
  } catch {
    return undefined;
  }
}
