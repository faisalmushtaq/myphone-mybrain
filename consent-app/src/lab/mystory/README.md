# MyStory chat protocols, one per phase of the break study

`pre.toml`, `mid.toml` and `post.toml` are MySelf MyStory protocols, in the
same format as `protocols/*.toml` in the MySelf repository (the KCL
micro-narratives format, plus MySelf's `[myself]` table), so the same file
loads in MySelf's MyStory studio and here. The website reads the sections and
keys listed in `docs/mystory.md` ("The AI chat"); the build checks each file
and stops if one cannot be run.

Changing a protocol: edit the file, bump `[myself] version`, push. The server
(`firebase/functions/src/storyChat.ts`) picks it up at the next deploy, and
every story records the protocol key and version it was told under.

The wording is a DRAFT for the team to replace, like the native MyStory's.
