const path = require('path')
const fs = require('fs')
const esbuild = require('esbuild')

async function build() {
  // Clean build directory
  const buildDir = path.join(__dirname, 'build')
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true })
  }
  fs.mkdirSync(buildDir, { recursive: true })

  // Bundle TypeScript source
  await esbuild.build({
    bundle: true,
    format: 'iife',
    target: ['firefox115'],
    entryPoints: ['content/scihub.ts'],
    outdir: 'build/content',
  })

  // Copy static files to build directory
  const filesToCopy = [
    { src: 'manifest.json', dest: 'manifest.json' },
    { src: 'bootstrap.js', dest: 'bootstrap.js' },
    { src: 'prefs.js', dest: 'prefs.js' },
    { src: 'content/preferences.xhtml', dest: 'content/preferences.xhtml' },
    { src: 'content/preferences.js', dest: 'content/preferences.js' },
  ]

  for (const file of filesToCopy) {
    const destPath = path.join(buildDir, file.dest)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(file.src, destPath)
  }

  // Copy skin directory
  const skinSrcDir = path.join(__dirname, 'skin')
  const skinDestDir = path.join(buildDir, 'skin')
  copyDirSync(skinSrcDir, skinDestDir)

  // Copy locale directory (Fluent .ftl files used by Zotero 8+ menus)
  const localeSrcDir = path.join(__dirname, 'locale')
  const localeDestDir = path.join(buildDir, 'locale')
  copyDirSync(localeSrcDir, localeDestDir)
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

build().catch(err => {
  console.log(err)
  process.exit(1)
})
