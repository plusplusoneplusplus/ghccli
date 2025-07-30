/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Script to detect git-tracked source code files that contain network calls to google*.com domains
 */

// Configuration
const GOOGLE_DOMAIN_PATTERN = /google[^.\s]*\.com/gi;

// Patterns that suggest actual runtime network calls to Google domains
const NETWORK_CALL_PATTERNS = [
  // Direct fetch/axios/request calls with Google URLs
  /(?:fetch|axios|request|get|post|put|delete|http\.get|http\.post|http\.request|XMLHttpRequest)\s*\(\s*['"'`][^'"'`]*google[^.\s]*\.com/gi,
  
  // Network library imports/requires from Google domains (actual CDN/remote imports)
  /(?:import|require)\s*\(\s*['"'`]https?:\/\/[^'"'`]*google[^.\s]*\.com/gi,
  
  // Dynamic URL construction for network calls (variables that get used in fetch)
  /(?:const|let|var)\s+\w*(?:url|endpoint|host|domain|baseURL|apiUrl|uri)\s*=\s*['"'`][^'"'`]*https?:\/\/[^'"'`]*google[^.\s]*\.com/gi,
  
  // WebSocket connections
  /new\s+WebSocket\s*\(\s*['"'`][^'"'`]*google[^.\s]*\.com/gi,
  
  // Shell commands that make network calls
  /(?:curl|wget|http|https)\s+[^'"'`\s]*google[^.\s]*\.com/gi,
  
  // Script/link tags with Google sources (in HTML/JSX)
  /<(?:script|link)\s+[^>]*(?:src|href)\s*=\s*['"'][^'"]*google[^.\s]*\.com/gi,
];
const SOURCE_EXTENSIONS = [
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.cpp', '.c', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift',
  '.kt', '.scala', '.clj', '.sh', '.bash', '.zsh',
  '.md', '.yaml', '.yml', '.json', '.xml', '.html',
  '.css', '.scss', '.less', '.sql'
];

function isSourceFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Skip test files
  if (filePath.endsWith('.test.ts')) {
    return false;
  }
  
  // Skip markdown files
  if (ext === '.md') {
    return false;
  }
  
  return SOURCE_EXTENSIONS.includes(ext);
}

function getGitTrackedFiles() {
  try {
    const output = execSync('git ls-files', { encoding: 'utf8' });
    return output.trim().split('\n').filter(file => file.length > 0);
  } catch (error) {
    console.error('Error getting git-tracked files:', error.message);
    process.exit(1);
  }
}

function searchFileForGoogleDomains(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Check each network call pattern
      NETWORK_CALL_PATTERNS.forEach(pattern => {
        const lineMatches = line.match(pattern);
        if (lineMatches) {
          lineMatches.forEach(match => {
            matches.push({
              line: index + 1,
              content: line.trim(),
              match: match,
              pattern: pattern.toString()
            });
          });
        }
      });
    });
    
    return matches;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const noFail = args.includes('--no-fail') || args.includes('-n');
  const help = args.includes('--help') || args.includes('-h');
  
  if (help) {
    console.log('Usage: node check-google-domains.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  -n, --no-fail    Do not exit with error code when domains are found');
    console.log('  -h, --help       Show this help message');
    console.log('');
    console.log('Searches for google*.com network calls in git-tracked source files.');
    process.exit(0);
  }
  
  console.log('🔍 Checking git-tracked source files for google*.com network calls...\n');
  
  const gitFiles = getGitTrackedFiles();
  const sourceFiles = gitFiles.filter(isSourceFile);
  
  console.log(`📁 Found ${sourceFiles.length} source files to check (out of ${gitFiles.length} total git-tracked files)\n`);
  
  let totalMatches = 0;
  const filesWithMatches = [];
  
  sourceFiles.forEach(filePath => {
    const matches = searchFileForGoogleDomains(filePath);
    if (matches.length > 0) {
      filesWithMatches.push({ filePath, matches });
      totalMatches += matches.length;
    }
  });
  
  if (filesWithMatches.length === 0) {
    console.log('✅ No google*.com network calls found in source files!');
    process.exit(0);
  }
  
  console.log(`⚠️  Found ${totalMatches} google*.com network call(s) in ${filesWithMatches.length} file(s):\n`);
  
  filesWithMatches.forEach(({ filePath, matches }) => {
    console.log(`📄 ${filePath}:`);
    matches.forEach(({ line, content, match, pattern }) => {
      console.log(`   Line ${line}: ${match}`);
      console.log(`   Content: ${content}`);
      console.log(`   Pattern: ${pattern}`);
    });
    console.log('');
  });
  
  console.log(`\n🚨 Summary: ${totalMatches} network call(s) found in ${filesWithMatches.length} file(s)`);
  
  // Exit with error code to indicate matches were found (unless --no-fail is specified)
  if (!noFail) {
    process.exit(1);
  }
}

// Run the script
main();