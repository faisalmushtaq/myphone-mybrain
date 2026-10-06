import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ALLOWED_CLEANED_FILES, buildCleanedZip, cleanArchive, cleanedArchiveName, detectPlatforms, parseYtHtml, type CategoryId } from './cleaner';

const tiktokExport = {
  'Your Activity': {
    'Watch History': { VideoList: [{ Date: '2026-09-01 20:11:03', Link: 'https://www.tiktokv.com/share/video/1/', Something: 'x' }, { Date: '2026-09-01 20:12:40', Link: 'https://www.tiktokv.com/share/video/2/' }] },
    Searches: { SearchList: [{ Date: '2026-09-02 08:00:00', SearchTerm: 'study tips' }] },
    Reposts: { RepostList: [{ Date: '2026-09-03', Link: 'https://www.tiktokv.com/share/video/3/' }] },
    'Share History': { ShareHistoryList: [{ Date: '2026-09-03', Link: 'https://www.tiktokv.com/share/video/4/', Method: 'copy_link', Target: 'friend' }] },
    'Login History': { LoginHistoryList: [{ Date: '2026-09-01 20:10:00', IP: '10.0.0.1', DeviceModel: 'iPhone', NetworkType: 'Wi-Fi' }] },
  },
  'Likes and Favorites': { 'Like List': { ItemFavoriteList: [{ date: '2026-09-01', link: 'https://www.tiktokv.com/share/video/5/' }] } },
  'Direct Message': { 'Direct Messages': { ChatHistory: { 'Chat with Sam': [{ Date: '2026-09-01', From: 'Sam', Content: 'private words' }] } } },
  Profile: { 'Profile Information': { ProfileMap: { emailAddress: 'me@example.com', telephoneNumber: '07700 900000' } } },
};

async function tiktokZip(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('user_data_tiktok.json', JSON.stringify(tiktokExport));
  return zip;
}

const takeoutHtml = `<html><body><div class="mdl-grid">
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">
<p class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></p>
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched&nbsp;<a href="https://www.youtube.com/watch?v=abc">How brains work &amp; why</a><br><a href="https://www.youtube.com/channel/UC1">Brain Channel</a><br>Oct 1, 2026, 3:01:48 PM BST</div>
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div>
<div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;YouTube<br><b>Details:</b><br>&emsp;From Google Ads</div>
</div></div>
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">
<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Searched for&nbsp;<a href="https://www.youtube.com/results?search_query=sleep+tips">sleep tips</a><br>Oct 2, 2026, 9:15:00 AM BST</div>
</div></div>
</div></body></html>`;

async function youtubeZip(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('Takeout/YouTube and YouTube Music/history/watch-history.json', JSON.stringify([
    { header: 'YouTube', title: 'Watched How brains work', titleUrl: 'https://www.youtube.com/watch?v=abc', subtitles: [{ name: 'Brain Channel', url: 'https://www.youtube.com/channel/UC1' }], time: '2026-10-01T14:01:48.000Z', products: ['YouTube'], activityControls: ['YouTube watch history'], details: [{ name: 'From Google Ads' }] },
  ]));
  zip.file('Takeout/YouTube and YouTube Music/history/search-history.html', takeoutHtml);
  zip.file('Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv', 'Channel Id,Channel Url,Channel Title\nUC1,https://www.youtube.com/channel/UC1,Brain Channel\nUC2,https://www.youtube.com/channel/UC2,Sleep Lab\n');
  zip.file('Takeout/YouTube and YouTube Music/comments/comments.csv', 'Comment Id,Comment Text\n1,my private comment\n');
  return zip;
}

describe('TikTok cleaning', () => {
  it('detects the platform and keeps only dates, links and search terms', async () => {
    const zip = await tiktokZip();
    expect(await detectPlatforms(zip)).toEqual(['tiktok']);
    const { files, report, preview } = await cleanArchive(zip);
    expect(report.platforms).toEqual(['tiktok']);
    expect(report.kept).toMatchObject({ tt_watch: 2, tt_search: 1, tt_engage: 3, tt_login: 1 });
    const out = JSON.parse(files.find((f) => f.path === 'tiktok_cleaned.json')!.text);
    expect(out.Activity.WatchHistory[0]).toEqual({ Date: '2026-09-01 20:11:03', Link: 'https://www.tiktokv.com/share/video/1/' });
    expect(out.Activity.LoginTimestamps[0]).toEqual({ Date: '2026-09-01 20:10:00' });
    expect(out.Activity.Shares[0]).toEqual({ Date: '2026-09-03', Link: 'https://www.tiktokv.com/share/video/4/', Method: 'copy_link' });
    const all = files.map((f) => f.text).join('\n');
    expect(all).not.toContain('private words');
    expect(all).not.toContain('me@example.com');
    expect(all).not.toContain('10.0.0.1');
    expect(out.AggregateCounts['Direct Message']).toBe(1);
    expect(preview.map((p) => p.kind)).toEqual(['Watched', 'Watched', 'Searched']);
    expect(files.every((f) => ALLOWED_CLEANED_FILES.includes(f.path))).toBe(true);
  });

  it('drops a category the participant unticks', async () => {
    const on = new Set<CategoryId>(['tt_watch', 'tt_counts']);
    const { files, report } = await cleanArchive(await tiktokZip(), on);
    const out = JSON.parse(files.find((f) => f.path === 'tiktok_cleaned.json')!.text);
    expect(out.Activity.Searches).toBeUndefined();
    expect(report.kept.tt_search).toBeUndefined();
    expect(out.Activity.WatchHistory).toHaveLength(2);
    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.text);
    expect(manifest.categories).toEqual(['tt_watch', 'tt_counts']);
  });
});

describe('YouTube cleaning', () => {
  it('reads Takeout JSON and HTML, keeps the study fields and drops everything else', async () => {
    const zip = await youtubeZip();
    expect(await detectPlatforms(zip)).toEqual(['youtube']);
    const { files, report } = await cleanArchive(zip);
    expect(report.platforms).toEqual(['youtube']);
    expect(report.kept).toEqual({ yt_watch: 1, yt_search: 2, yt_subs: 2 });
    const watch = JSON.parse(files.find((f) => f.path === 'youtube/history/watch-history.json')!.text);
    expect(Object.keys(watch[0]).sort()).toEqual(['header', 'subtitles', 'time', 'title', 'titleUrl']);
    const search = JSON.parse(files.find((f) => f.path === 'youtube/history/search-history.json')!.text);
    expect(search[1]).toEqual({ header: 'YouTube', title: 'Searched for sleep tips', titleUrl: 'https://www.youtube.com/results?search_query=sleep+tips', time: 'Oct 2, 2026, 9:15:00 AM BST' });
    expect(files.some((f) => f.path.includes('comments'))).toBe(false);
    expect(cleanedArchiveName(report.platforms)).toBe('youtube_cleaned_donation.zip');
  });

  it('parses the Takeout HTML layout without a DOM', () => {
    const rows = parseYtHtml(takeoutHtml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ header: 'YouTube', title: 'Watched How brains work & why', titleUrl: 'https://www.youtube.com/watch?v=abc', subtitles: [{ name: 'Brain Channel', url: 'https://www.youtube.com/channel/UC1' }], time: 'Oct 1, 2026, 3:01:48 PM BST' });
  });

  it('refuses an archive with nothing it recognises, and rebuilds a valid zip from the cleaned files', async () => {
    const other = new JSZip();
    other.file('notes.txt', 'hello');
    await expect(cleanArchive(other)).rejects.toThrow(/No TikTok, YouTube or Instagram data/);
    const { files } = await cleanArchive(await youtubeZip());
    const buffer = (await buildCleanedZip(JSZip, files, 'nodebuffer')) as Buffer;
    const reopened = await JSZip.loadAsync(buffer);
    expect(Object.keys(reopened.files).sort()).toEqual(['manifest.json', 'youtube/', 'youtube/history/', 'youtube/history/search-history.json', 'youtube/history/watch-history.json', 'youtube/subscriptions/', 'youtube/subscriptions/subscriptions.csv']);
  });
});

describe('Instagram cleaning', () => {
  const igExport = async (): Promise<JSZip> => {
    const zip = new JSZip();
    zip.file('ads_information/ads_and_topics/videos_watched.json', JSON.stringify({ impressions_history_videos_watched: [{ string_map_data: { Author: { value: 'someone' }, Time: { timestamp: 1759300000 } }, timestamp: 1759300000, label_values: [{ label: 'URL', value: 'https://www.instagram.com/reel/abc/' }, { label: 'Author', value: 'someone' }] }] }));
    zip.file('ads_information/ads_and_topics/posts_viewed.json', JSON.stringify({ impressions_history_posts_seen: [{ string_list_data: [{ href: 'https://www.instagram.com/p/def/', timestamp: 1759310000 }] }] }));
    zip.file('your_instagram_activity/likes/liked_posts.json', JSON.stringify({ likes_media_likes: [{ title: 'someone', string_list_data: [{ href: 'https://www.instagram.com/p/ghi/', value: '👍', timestamp: 1759320000 }] }] }));
    zip.file('logged_information/recent_searches/word_or_phrase_searches.json', JSON.stringify({ searches_keyword: [{ string_map_data: { Search: { value: 'sleep tips', timestamp: 1759330000 } }, title: 'sleep tips', string_list_data: [{ value: 'sleep tips', timestamp: 1759330000 }] }] }));
    zip.file('logged_information/recent_searches/profile_searches.json', JSON.stringify({ searches_user: [{ title: 'a_friend', string_list_data: [{ value: 'a_friend', timestamp: 1759340000 }] }] }));
    zip.file('your_instagram_activity/messages/inbox/friend/message_1.json', JSON.stringify({ messages: [{ content: 'private words' }] }));
    zip.file('personal_information/personal_information.json', JSON.stringify({ profile_user: [{ string_map_data: { Email: { value: 'me@example.com' } } }] }));
    return zip;
  };
  it('detects Instagram, keeps time and link only, and drops messages and profile details', async () => {
    const zip = await igExport();
    expect(await detectPlatforms(zip)).toEqual(['instagram']);
    const { files, report, preview } = await cleanArchive(zip);
    expect(report.platforms).toEqual(['instagram']);
    expect(report.kept).toMatchObject({ ig_watch: 1, ig_posts: 1, ig_likes: 1, ig_search: 2 });
    expect(files.map((f) => f.path).sort()).toEqual(['instagram/likes.json', 'instagram/posts_viewed.json', 'instagram/reels_watched.json', 'instagram/searches.json', 'manifest.json']);
    expect(JSON.parse(files.find((f) => f.path === 'instagram/reels_watched.json')!.text)).toEqual([{ time: '2025-10-01T06:26:40.000Z', url: 'https://www.instagram.com/reel/abc/' }]);
    const searches = JSON.parse(files.find((f) => f.path === 'instagram/searches.json')!.text);
    expect(searches.map((s: { search: string }) => s.search)).toEqual(['sleep tips', 'a_friend']);
    const all = files.map((f) => f.text).join('\n');
    expect(all).not.toContain('private words');
    expect(all).not.toContain('me@example.com');
    expect(all).not.toContain('someone');
    expect(preview.map((p) => p.kind)).toEqual(['Watched', 'Viewed', 'Liked', 'Searched', 'Searched']);
    for (const f of files) expect(ALLOWED_CLEANED_FILES).toContain(f.path);
    expect(cleanedArchiveName(report.platforms)).toBe('instagram_cleaned_donation.zip');
  });
  it('refuses an Instagram export requested in HTML and says what to do', async () => {
    const zip = new JSZip();
    zip.file('your_instagram_activity/likes/liked_posts.html', '<html></html>');
    await expect(detectPlatforms(zip)).rejects.toThrow(/JSON/);
  });
  it('unticking a category leaves it out', async () => {
    const zip = await igExport();
    const on = new Set<CategoryId>(['ig_watch']);
    const { files, report } = await cleanArchive(zip, on);
    expect(files.map((f) => f.path).sort()).toEqual(['instagram/reels_watched.json', 'manifest.json']);
    expect(report.kept).toEqual({ ig_watch: 1 });
  });
});
