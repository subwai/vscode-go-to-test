const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const ss = require("string-similarity");

const PATTERNS = {
  f: "(.+)", // Filename
  e: "(\\.\\w+)", // File extension
};
const PATTERN_REGEX = /\{(\w)\}/g;

const { specFilePatterns } = vscode.workspace.getConfiguration("goToTest");
const specFileRegexes = specFilePatterns.map((pattern) =>
  RegExp(pattern.replace(PATTERN_REGEX, (_, param) => PATTERNS[param] || ""))
);

function getCodeFilename(specFilename, specFileRegex) {
  const matches = specFilename.match(specFileRegex);
  return `${matches[1]}${matches[2]}`;
}

function getSpecFilename(codeFilename, specFilePattern) {
  const fileExt = path.extname(codeFilename);
  const finenameWithoutExension = path.basename(codeFilename, fileExt);
  return specFilePattern.replace(PATTERN_REGEX, (_, param) => {
    switch (param) {
      case "f":
        return finenameWithoutExension;
      case "e":
        return fileExt;
      default:
        return "";
    }
  });
}

function getMatchingSpecFileRegex(filename) {
  for (const regex of specFileRegexes) {
    if (regex.test(filename)) {
      return regex;
    }
  }
  return null;
}

function fileExists(fullPath) {
  try {
    return !!fs.statSync(fullPath);
  } catch {
    return false;
  }
}

async function findFile(filename, originalFilePath) {
  const testPath = path.resolve(originalFilePath, "../__tests__", filename);
  const origPath = path.resolve(originalFilePath, "../..", filename);
  const foundUris = [testPath, origPath].filter(fileExists);

  if (foundUris.length === 0) {
    return null;
  }
  const ratings = ss.findBestMatch(originalFilePath, foundUris);
  const bestMatch = ratings.bestMatch;
  const alternatives = ratings.ratings.filter(
    (r) => r.target !== bestMatch.target
  );
  // Tolerancy index is arbitrary and subject to change
  const tolerancy = 0.05;
  const filteredAlternatives = alternatives.filter(
    (a) => Math.abs(bestMatch.rating - a.rating) <= tolerancy
  );
  if (filteredAlternatives.length === 0) {
    return bestMatch.target;
  } else {
    return vscode.window.showQuickPick([
      bestMatch.target,
      ...filteredAlternatives.map((a) => a.target),
    ]);
  }
}

async function openFile(filePath) {
  const document = await vscode.workspace.openTextDocument(filePath);
  return vscode.window.showTextDocument(document);
}

async function findAndOpenFile(filename, originalFilePath) {
  const fileToOpen = await findFile(filename, originalFilePath);
  if (!fileToOpen) {
    throw new Error(`File "${filename}" not found`);
  }
  return openFile(fileToOpen);
}

function activate(context) {
  let disposable = vscode.commands.registerCommand(
    "extension.goToTest",
    async function () {
      if (!vscode.workspace.name) {
        return;
      }

      const activeFile = vscode.window.activeTextEditor;
      if (!activeFile) {
        return;
      }

      const openedFilePath = activeFile.document.fileName;
      const openedFilename = path.basename(openedFilePath);

      const matchingSpecFileRegex = getMatchingSpecFileRegex(openedFilename);
      if (!matchingSpecFileRegex) {
        // We are in a code file
        // We search for the the first spec file matching one of the spec file patterns
        const specFilePath = await specFilePatterns.reduce(
          async (lastP, pattern) => {
            const path = await lastP;
            if (path) {
              return path;
            }
            const specFilename = getSpecFilename(openedFilename, pattern);
            return findFile(specFilename, openedFilePath);
          },
          Promise.resolve(null)
        );
        if (specFilePath) {
          return openFile(specFilePath);
        }
        throw new Error(`No test file found for file "${openedFilename}"`);
      } else {
        // We are in a spec file
        const filenameToOpen = getCodeFilename(
          openedFilename,
          matchingSpecFileRegex
        );
        await findAndOpenFile(filenameToOpen, openedFilePath);
      }
    }
  );

  context.subscriptions.push(disposable);
}

exports.activate = activate;

function deactivate() {}

exports.deactivate = deactivate;
