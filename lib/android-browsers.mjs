// The oldest phone browser the Android till's copy of the page is built for
// (scripts/build-desktop.mjs --android). android/…/WebViewCheck.java shows
// "too old" below it, so the two must agree: tests/android-browsers.test.ts.
export const ANDROID_CHROME = 91;
export const ANDROID_BROWSERS = [`chrome ${ANDROID_CHROME}`];

/**
 * Tailwind wraps everything in @layer, which Chrome only reads from 99: an
 * older one drops every rule inside, and the page has no styles at all. The
 * layers come in the file in the order of their priority, so taking the rules
 * out of them keeps which one wins.
 */
export function unlayer(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@layer', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const semi = css.indexOf(';', at);
    const open = css.indexOf('{', at);
    // `@layer a, b;` only names the order: drop it.
    if (semi !== -1 && (open === -1 || semi < open)) { i = semi + 1; continue; }
    // `@layer a { … }`: keep what is inside.
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    out += unlayer(css.slice(open + 1, j - 1));
    i = j;
  }
  return out;
}

/**
 * Tailwind moves and turns things with the translate and rotate properties,
 * which Chrome only reads from 104: an older one drops them, and everything
 * centred with -translate-x-1/2 sits half its width off (the search icon, the
 * line under the bottom menu's tab). Written again as transform, which every
 * phone reads. scale is left alone: it is only a press effect, and its
 * percentages are not valid inside an old transform.
 */
export function oldTransforms(css) {
  return css
    .replaceAll(
      'translate:var(--tw-translate-x) var(--tw-translate-y)',
      'transform:translate(var(--tw-translate-x,0),var(--tw-translate-y,0))',
    )
    .replace(/([;{])rotate:(-?[\d.]+deg)/g, '$1transform:rotate($2)');
}
