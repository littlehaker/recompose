import fs from 'fs'
import path from 'path'
import { exec, exit, rm, cp, test } from 'shelljs'
import chalk from 'chalk'
import { compose } from 'lodash'
import readline from 'readline-sync'
import semver from 'semver'
import glob from 'glob'

const BIN = './node_modules/.bin'

import {
  PACKAGES_SRC_DIR,
  PACKAGES_OUT_DIR,
  getPackageNames
} from './getPackageNames'

const BASE_PACKAGE_LOC = '../src/basePackage.json'

const consoleLog = console.log.bind(console)
const log = compose(consoleLog, chalk.bold)
const logSuccess = compose(consoleLog, chalk.green.bold)
const logError = compose(consoleLog, chalk.red.bold)

const writeFile = (filepath, string) => (
  fs.writeFileSync(filepath, string, 'utf8')
)

if (exec('git diff-files --quiet').code !== 0) {
  logError(
    'You have unsaved changes in the working tree. Commit or stash changes ' +
    'before releasing.'
  )
  exit(1)
}

const packageNames = getPackageNames()

let packageName = readline.question('Name of package to release: ')

while (!packageNames.includes(packageName)) {
  packageName = readline.question(
    `The package "${packageName}" does not exist in this project. ` +
    `Choose again: `
  )
}

const versionLoc = path.resolve(PACKAGES_SRC_DIR, packageName, 'VERSION')
const version = fs.readFileSync(versionLoc, 'utf8').trim()

let nextVersion = readline.question(
  `Next version of ${packageName} (current version is ${version}): `
)

while (!(
  !nextVersion ||
  (semver.valid(nextVersion) && semver.gt(nextVersion, version))
)) {
  nextVersion = readline.question(
    `Must provide a valid version that is greater than ${version}, `
  + `or leave blank to skip: `
  )
}

log('Running tests...')

if (exec('npm run lint && npm test -- --single-run').code !== 0) {
  logError(
    'The test command did not exit cleanly. Aborting release.'
  )
  exit(1)
}

logSuccess('Tests were successful.')

const sourceDir = path.resolve(PACKAGES_SRC_DIR, packageName)
const outDir = path.resolve(PACKAGES_OUT_DIR, packageName)

log('Cleaning destination directory...')
rm('-rf', outDir)

log('Compiling source files...')

const sourceFiles = glob.sync(`${sourceDir}/**/*.js`, {
  ignore: `${sourceDir}/node_modules/**/*.js`
}).map(to => path.relative(sourceDir, to))

exec(`cd ${sourceDir} && ${path.resolve(BIN)}/babel ${sourceFiles.join(' ')} --out-dir ${path.resolve(outDir)}`)

log('Copying additional project files...')
const additionalProjectFiles = [
  'README.md',
  '.npmignore'
]
additionalProjectFiles.forEach(filename => {
  const src = path.resolve(sourceDir, filename)

  if (!test('-e', src)) return

  cp('-Rf', src, outDir)
})

log('Generating package.json...')
const packageConfig = {
  name: packageName,
  version: nextVersion,
  ...require(BASE_PACKAGE_LOC),
  ...require(path.resolve(sourceDir, 'package.json')),
  private: undefined,
}

writeFile(
  path.resolve(outDir, 'package.json'),
  JSON.stringify(packageConfig, null, 2)
)

log(`About to publish ${packageName}@${nextVersion} to npm.`)
if (!readline.keyInYN('Sound good? ')) {
  log('OK. Stopping release.')
  exit(0)
}

log('Publishing...')
if (exec(`cd ${outDir} && npm publish`).code !== 0) {
  logError('Publish failed. Aborting release.')
  exit(1)
}

logSuccess(`${packageName}@${nextVersion} was successfully published.`)

log('Updating VERSION file...')
writeFile(versionLoc, `${nextVersion}\n`)

log('Committing changes...')
const newTagName = `v${nextVersion}`
exec(`git add ${versionLoc}`)
exec(`git commit -m "${packageName} ${newTagName}"`)

if (packageName === 'recompose') {
  log(`Tagging release... (${newTagName})`)
  exec(`git tag ${newTagName}`)
}

log('Pushing to GitHub...')
exec('git push')
exec('git push --tags')

logSuccess('Done.')
