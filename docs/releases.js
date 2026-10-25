// Versions and download links for both pages, straight from GitHub.
// BACon (vX.Y.Z) and Rasher (rasher-vX.Y.Z) share the repo's releases, and Rasher's are never "latest", so each app's
// newest is picked here by its tag and its exe. The links in the HTML work without this; it only makes them exact.
//   data-version="bacon|rasher"        the tag, v0.1.0
//   data-version-plain="bacon|rasher"  the version, 0.1.0
//   data-download="bacon|rasher"       an <a> to the exe
//   data-release="bacon|rasher"        an <a> to the release page
;(() => {
  const APPS = { bacon: [/^v\d+\.\d+\.\d+$/, 'BACon.exe'], rasher: [/^rasher-v\d+\.\d+\.\d+$/, 'Rasher.exe'] }
  const semver = (tag) => tag.replace(/^\D+/, '').split('.').map(Number)
  const older = (a, b) => { const x = semver(a.tag_name), y = semver(b.tag_name); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }
  fetch('https://api.github.com/repos/TheeHappyCoder/BACon/releases?per_page=50')
    .then((r) => (r.ok ? r.json() : []))
    .then((all) => {
      for (const [app, [tag, exe]] of Object.entries(APPS)) {
        const rel = all.filter((r) => !r.draft && !r.prerelease && tag.test(r.tag_name) && r.assets.some((a) => a.name === exe)).sort(older).pop()
        if (!rel) continue
        const url = rel.assets.find((a) => a.name === exe).browser_download_url
        document.querySelectorAll(`[data-version="${app}"]`).forEach((el) => (el.textContent = rel.tag_name.replace(/^rasher-/, '')))
        document.querySelectorAll(`[data-version-plain="${app}"]`).forEach((el) => (el.textContent = semver(rel.tag_name).join('.')))
        document.querySelectorAll(`a[data-download="${app}"]`).forEach((a) => (a.href = url))
        document.querySelectorAll(`a[data-release="${app}"]`).forEach((a) => (a.href = rel.html_url))
      }
    })
    .catch(() => {})
})()
