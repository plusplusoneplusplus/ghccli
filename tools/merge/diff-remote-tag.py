#!/usr/bin/env python3
"""
Find commits that exist in a remote tag but not in the current HEAD.

This script compares the current HEAD with a remote tag and identifies commits
that need to be cherry-picked. It generates a file with commits in oldest-first
order, ready for cherry-picking.
"""

import argparse
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Tuple
from urllib.parse import urlparse


class Colors:
    """ANSI color codes for terminal output."""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'


class DiffRemoteTagError(Exception):
    """Exception raised during diff-remote-tag operations."""
    pass


class DiffRemoteTag:
    """Handles finding commits in remote tags that are missing from HEAD."""
    
    def __init__(self):
        self.owner = ""
        self.repo = ""
        self.tag = ""
        self.remote_url = ""
        self.remote_name = ""
        self.tag_commit = ""
        self.current_head = ""
    
    def print_info(self, message: str):
        """Print info message."""
        print(f"{Colors.BLUE}[INFO]{Colors.RESET} {message}")
    
    def print_success(self, message: str):
        """Print success message."""
        print(f"{Colors.GREEN}[SUCCESS]{Colors.RESET} {message}")
    
    def print_warning(self, message: str):
        """Print warning message."""
        print(f"{Colors.YELLOW}[WARNING]{Colors.RESET} {message}")
    
    def print_error(self, message: str):
        """Print error message."""
        print(f"{Colors.RED}[ERROR]{Colors.RESET} {message}")
    
    def run_git_command(self, cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
        """Run a git command and return the result."""
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=check)
            return result
        except subprocess.CalledProcessError as e:
            if not check:
                return e
            raise DiffRemoteTagError(f"Git command failed: {' '.join(cmd)}\n{e.stderr}")
    
    def parse_tag_url(self, tag_url: str) -> Tuple[str, str, str]:
        """Parse GitHub tag URL and extract owner, repo, and tag."""
        # Expected format: https://github.com/owner/repo/releases/tag/tagname
        pattern = r'^https://github\.com/([^/]+)/([^/]+)/releases/tag/(.+)$'
        match = re.match(pattern, tag_url)
        
        if not match:
            raise DiffRemoteTagError(
                "Invalid tag URL format. Expected: https://github.com/owner/repo/releases/tag/tagname"
            )
        
        owner, repo, tag = match.groups()
        return owner, repo, tag
    
    def verify_git_repository(self):
        """Verify we're in a git repository."""
        try:
            result = self.run_git_command(["git", "rev-parse", "--git-dir"])
        except DiffRemoteTagError:
            raise DiffRemoteTagError("Not in a git repository")
    
    def get_current_head(self) -> str:
        """Get current HEAD commit hash."""
        result = self.run_git_command(["git", "rev-parse", "HEAD"])
        return result.stdout.strip()
    
    def get_short_commit(self, commit_hash: str) -> str:
        """Get short version of commit hash."""
        result = self.run_git_command(["git", "rev-parse", "--short", commit_hash])
        return result.stdout.strip()
    
    def remote_exists(self, remote_name: str) -> bool:
        """Check if a remote exists."""
        result = self.run_git_command(["git", "remote", "get-url", remote_name], check=False)
        return result.returncode == 0
    
    def add_remote(self, remote_name: str, remote_url: str):
        """Add a git remote."""
        if self.remote_exists(remote_name):
            self.print_info(f"Remote '{remote_name}' already exists")
        else:
            self.print_info(f"Adding remote '{remote_name}'...")
            self.run_git_command(["git", "remote", "add", remote_name, remote_url])
    
    def fetch_remote(self, remote_name: str):
        """Fetch from remote including tags."""
        self.print_info(f"Fetching from remote '{remote_name}'...")
        self.run_git_command(["git", "fetch", remote_name, "--tags"])
    
    def tag_exists(self, tag: str) -> bool:
        """Check if a tag exists."""
        result = self.run_git_command(["git", "rev-parse", "--verify", f"refs/tags/{tag}"], check=False)
        return result.returncode == 0
    
    def get_tag_commit(self, tag: str) -> str:
        """Get commit hash that a tag points to."""
        result = self.run_git_command(["git", "rev-parse", tag])
        return result.stdout.strip()
    
    def get_commits_in_tag_not_in_head(self, tag: str) -> List[str]:
        """Get list of commits in tag but not in HEAD."""
        result = self.run_git_command(["git", "log", "--format=%H", tag, "--not", "HEAD"])
        commits = [line.strip() for line in result.stdout.strip().split('\n') if line.strip()]
        return commits
    
    def get_commit_info(self, commit_hash: str) -> dict:
        """Get detailed information about a commit."""
        try:
            result = self.run_git_command([
                "git", "show", "--no-patch", 
                "--format=Author: %an <%ae>%nDate: %ad%nSubject: %s",
                commit_hash
            ])
            lines = result.stdout.strip().split('\n')
            
            info = {}
            for line in lines:
                if line.startswith('Author: '):
                    info['author'] = line[8:]
                elif line.startswith('Date: '):
                    info['date'] = line[6:]
                elif line.startswith('Subject: '):
                    info['subject'] = line[9:]
            
            return info
        except DiffRemoteTagError:
            return {
                'author': 'Unknown',
                'date': 'Unknown',
                'subject': 'Unknown'
            }
    
    def generate_output_file(self, commits: List[str], output_file: str):
        """Generate the output file with commit information."""
        # Reverse commits to get oldest-first order for cherry-picking
        oldest_first_commits = list(reversed(commits))
        
        with open(output_file, 'w') as f:
            # Header
            f.write(f"# Commits in {self.tag} that are not in HEAD\n")
            f.write(f"# Generated on {datetime.now().strftime('%a %b %d %H:%M:%S %Z %Y')}\n")
            f.write(f"# Repository: {self.remote_url}\n")
            f.write(f"# Tag: {self.tag} ({self.tag_commit})\n")
            f.write(f"# Current HEAD: {self.current_head}\n")
            f.write("\n")
            
            # Commit IDs (oldest first - for cherry-picking)
            f.write("# Commit IDs (oldest first - for cherry-picking):\n")
            for commit in oldest_first_commits:
                f.write(f"{commit}\n")
            
            f.write("\n")
            f.write("# Detailed commit information:\n")
            
            # Detailed information for each commit (in oldest-first order)
            for commit in oldest_first_commits:
                f.write("----------------------------------------\n")
                f.write(f"Commit: {commit}\n")
                
                info = self.get_commit_info(commit)
                f.write(f"Author: {info['author']}\n")
                f.write(f"Date: {info['date']}\n")
                f.write(f"Subject: {info['subject']}\n")
                f.write("\n")
    
    def show_commit_preview(self, commits: List[str], max_commits: int = 10):
        """Show a preview of the commits."""
        self.print_info(f"Preview of commits (showing up to {max_commits}):")
        
        # Show oldest first (same order as cherry-picking)
        oldest_first = list(reversed(commits))
        preview_commits = oldest_first[:max_commits]
        
        for commit in preview_commits:
            short_commit = self.get_short_commit(commit)
            info = self.get_commit_info(commit)
            subject = info.get('subject', 'Unknown')
            print(f"  {Colors.YELLOW}{short_commit}{Colors.RESET} {subject}")
        
        if len(commits) > max_commits:
            remaining = len(commits) - max_commits
            print(f"  ... and {remaining} more commit(s)")
    
    def run(self, tag_url: str, output_file: str = "remote-only-commits.txt"):
        """Main process to find and report commits."""
        try:
            # Parse tag URL
            self.owner, self.repo, self.tag = self.parse_tag_url(tag_url)
            self.remote_url = f"https://github.com/{self.owner}/{self.repo}.git"
            self.remote_name = f"upstream_{self.owner}_{self.repo}"
            
            self.print_info(f"Repository: {self.owner}/{self.repo}")
            self.print_info(f"Tag: {self.tag}")
            self.print_info(f"Remote URL: {self.remote_url}")
            
            # Verify git repository
            self.verify_git_repository()
            
            # Get current HEAD
            self.current_head = self.get_current_head()
            self.print_info(f"Current HEAD: {self.get_short_commit(self.current_head)}")
            
            # Add remote and fetch
            self.add_remote(self.remote_name, self.remote_url)
            self.fetch_remote(self.remote_name)
            
            # Verify tag exists
            if not self.tag_exists(self.tag):
                # Show available tags for reference
                result = self.run_git_command(["git", "tag", "-l"], check=False)
                available_tags = result.stdout.strip().split('\n')[:10]
                self.print_error(f"Tag '{self.tag}' not found. Available tags:")
                for tag in available_tags:
                    if tag.strip():
                        print(f"  {tag.strip()}")
                raise DiffRemoteTagError(f"Tag '{self.tag}' not found")
            
            # Get tag commit
            self.tag_commit = self.get_tag_commit(self.tag)
            self.print_info(f"Tag '{self.tag}' points to: {self.get_short_commit(self.tag_commit)}")
            
            # Find commits in tag but not in HEAD
            self.print_info(f"Finding commits in '{self.tag}' that are not in HEAD...")
            commits = self.get_commits_in_tag_not_in_head(self.tag)
            
            if not commits:
                self.print_success(f"No commits found in '{self.tag}' that are not in HEAD")
                return
            
            self.print_info(f"Found {len(commits)} commit(s) in '{self.tag}' that are not in HEAD")
            
            # Generate output file
            self.generate_output_file(commits, output_file)
            
            # Success message and summary
            self.print_success(f"Results saved to '{output_file}'")
            self.print_info("Summary:")
            self.print_info(f"  - Total commits in '{self.tag}' not in HEAD: {len(commits)}")
            self.print_info(f"  - Output file: {output_file}")
            
            # Show preview
            self.show_commit_preview(commits)
            
        except DiffRemoteTagError as e:
            self.print_error(str(e))
            sys.exit(1)
        except KeyboardInterrupt:
            self.print_warning("Process interrupted by user")
            sys.exit(1)
        except Exception as e:
            self.print_error(f"Unexpected error: {e}")
            sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Find commits in a remote tag that are not in the current HEAD",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s https://github.com/owner/repo/releases/tag/v1.2.3
  %(prog)s https://github.com/owner/repo/releases/tag/v1.2.3 my-commits.txt
        """
    )
    
    parser.add_argument(
        "tag_url",
        help="GitHub tag URL (e.g., https://github.com/owner/repo/releases/tag/v1.2.3)"
    )
    
    parser.add_argument(
        "output_file",
        nargs='?',
        default="remote-only-commits.txt",
        help="Output file name (default: remote-only-commits.txt)"
    )
    
    args = parser.parse_args()
    
    # Create and run the diff tool
    diff_tool = DiffRemoteTag()
    diff_tool.run(args.tag_url, args.output_file)


if __name__ == "__main__":
    main()