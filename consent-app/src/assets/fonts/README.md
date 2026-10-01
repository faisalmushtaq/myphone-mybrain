# Fonts embedded in the downloadable copy of the record

`AtkinsonHyperlegibleNext-Regular.ttf` and `-Bold.ttf` are Atkinson
Hyperlegible Next by the Braille Institute of America, licensed under the SIL
Open Font License 1.1 (`OFL.txt`). Each file is the Google Fonts `latin` and
`latin-ext` subsets of the font merged into one with fontTools
(`python3 -m fontTools.merge latin.ttf latin-ext.ttf`), so names with accented
and extended Latin letters print correctly. `coverage.ts` lists the code
points the files contain and is regenerated whenever the fonts change.

The site itself loads Atkinson Hyperlegible from Google Fonts; these files
are only fetched when someone downloads their copy, and are embedded in that
PDF.
