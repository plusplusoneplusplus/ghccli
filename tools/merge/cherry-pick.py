#!/usr/bin/env python3
"""
Cherry-pick commits with interactive conflict resolution.

This script cherry-picks commits one by one, waiting for user confirmation
when conflicts occur. It handles ongoing cherry-pick/rebase operations and
provides a smooth workflow for resolving merge conflicts.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional


class Colors:
    """ANSI color codes for terminal output."""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'


class CherryPickError(Exception):
    """Exception raised during cherry-pick operations."""
    pass


class CherryPicker:
    """Handles cherry-picking commits with conflict resolution."""
    
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.total_commits = 0
        self.successful_picks = 0
        self.skipped_commits = 0
        self.failed_commits = 0
        
    def run_git_command(self, cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
        """Run a git command and return the result."""
        if self.dry_run:
            print(f"{Colors.CYAN}[DRY RUN] Would run: {' '.join(cmd)}{Colors.RESET}")
            return subprocess.CompletedProcess(cmd, 0, "", "")
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=check)
            return result
        except subprocess.CalledProcessError as e:
            if not check:
                return e
            raise CherryPickError(f"Git command failed: {' '.join(cmd)}\n{e.stderr}")
    
    def is_git_operation_in_progress(self) -> tuple[bool, str]:
        """Check if there's an ongoing git operation (cherry-pick, rebase, merge)."""
        try:
            result = subprocess.run(["git", "rev-parse", "--git-dir"], 
                                  capture_output=True, text=True, check=True)
            git_dir = Path(result.stdout.strip())
        except subprocess.CalledProcessError:
            return False, ""
        
        operations = {
            "cherry-pick": git_dir / "CHERRY_PICK_HEAD",
            "rebase": git_dir / "rebase-merge" / "interactive",
            "merge": git_dir / "MERGE_HEAD",
            "revert": git_dir / "REVERT_HEAD"
        }
        
        for operation, marker_file in operations.items():
            if marker_file.exists():
                return True, operation
        
        # Also check rebase-apply directory
        if (git_dir / "rebase-apply").exists():
            return True, "rebase"
            
        return False, ""
    
    def get_git_status(self) -> str:
        """Get current git status."""
        result = self.run_git_command(["git", "status", "--porcelain"])
        return result.stdout.strip()
    
    def has_conflicts(self) -> bool:
        """Check if there are any unresolved merge conflicts."""
        status = self.get_git_status()
        # Check for actual conflict markers in git status --porcelain
        for line in status.split('\n'):
            if line and len(line) >= 2:
                # Look for actual conflict markers (UU, AA, DD, AU, UA, etc.)
                index_status = line[0]
                worktree_status = line[1]
                if (index_status == 'U' or worktree_status == 'U' or 
                    line.startswith('AA') or line.startswith('DD')):
                    return True
        return False
    
    def is_cherry_pick_ready_to_continue(self) -> bool:
        """Check if cherry-pick is ready to continue (conflicts resolved)."""
        # Check if we're in a cherry-pick state
        in_progress, operation = self.is_git_operation_in_progress()
        if not in_progress or operation != "cherry-pick":
            return False
        
        # Check if there are no unresolved conflicts
        return not self.has_conflicts()
    
    def show_conflict_status(self):
        """Display current conflict status."""
        result = self.run_git_command(["git", "status"])
        print(f"\n{Colors.YELLOW}Current git status:{Colors.RESET}")
        print(result.stdout)
        
        # Show conflicted files specifically
        conflicted_files = []
        status_lines = self.get_git_status().split('\n')
        for line in status_lines:
            if line and ("U" in line[:2] or line.startswith("DD") or line.startswith("AA")):
                conflicted_files.append(line[3:])
        
        if conflicted_files:
            print(f"{Colors.RED}Conflicted files:{Colors.RESET}")
            for file in conflicted_files:
                print(f"  - {file}")
    
    def wait_for_user_confirmation(self, commit_hash: str) -> str:
        """Wait for user to resolve conflicts and confirm continuation."""
        print(f"\n{Colors.YELLOW}{'='*60}{Colors.RESET}")
        print(f"{Colors.BOLD}Cherry-pick conflict detected for commit: {commit_hash}{Colors.RESET}")
        print(f"{Colors.YELLOW}{'='*60}{Colors.RESET}")
        
        self.show_conflict_status()
        
        print(f"\n{Colors.CYAN}Instructions:{Colors.RESET}")
        print("1. Resolve the conflicts in the files listed above")
        print("2. Stage the resolved files with: git add <file>")
        print("3. Complete the cherry-pick with: git cherry-pick --continue")
        print("4. Come back here and type your choice")
        
        while True:
            print(f"\n{Colors.BOLD}What would you like to do?{Colors.RESET}")
            print(f"  {Colors.GREEN}y{Colors.RESET} - Continue (conflicts resolved)")
            print(f"  {Colors.YELLOW}n{Colors.RESET} - Still working on conflicts")
            print(f"  {Colors.MAGENTA}s{Colors.RESET} - Skip this commit")
            print(f"  {Colors.RED}q{Colors.RESET} - Quit the process")
            
            choice = input(f"\n{Colors.BOLD}Your choice [y/n/s/q]: {Colors.RESET}").strip().lower()
            
            if choice == 'y':
                return 'continue'
            elif choice == 'n':
                print(f"{Colors.YELLOW}Take your time to resolve the conflicts...{Colors.RESET}")
                continue
            elif choice == 's':
                return 'skip'
            elif choice == 'q':
                return 'quit'
            else:
                print(f"{Colors.RED}Invalid choice. Please enter y, n, s, or q.{Colors.RESET}")
    
    def handle_ongoing_operation(self, operation: str):
        """Handle an ongoing git operation."""
        print(f"{Colors.YELLOW}Detected ongoing {operation} operation.{Colors.RESET}")
        
        if self.has_conflicts():
            print(f"{Colors.RED}There are unresolved conflicts.{Colors.RESET}")
            self.show_conflict_status()
            print(f"\n{Colors.CYAN}Please resolve conflicts and run:{Colors.RESET}")
            if operation == "cherry-pick":
                print("  git cherry-pick --continue")
            elif operation == "rebase":
                print("  git rebase --continue")
            elif operation == "merge":
                print("  git commit")
        
        while True:
            choice = input(f"\n{Colors.BOLD}Continue with the process? [y/n/q]: {Colors.RESET}").strip().lower()
            
            if choice == 'y':
                if not self.has_conflicts():
                    print(f"{Colors.GREEN}Operation appears to be resolved. Continuing...{Colors.RESET}")
                    return True
                else:
                    print(f"{Colors.RED}Conflicts still exist. Please resolve them first.{Colors.RESET}")
                    continue
            elif choice == 'n':
                print(f"{Colors.YELLOW}Waiting for you to complete the operation...{Colors.RESET}")
                continue
            elif choice == 'q':
                print(f"{Colors.RED}Quitting. You can resume later.{Colors.RESET}")
                return False
            else:
                print(f"{Colors.RED}Invalid choice. Please enter y, n, or q.{Colors.RESET}")
    
    def cherry_pick_commit(self, commit_hash: str) -> bool:
        """Cherry-pick a single commit. Returns True if successful."""
        if self.dry_run:
            print(f"{Colors.CYAN}[DRY RUN] Would cherry-pick: {commit_hash}{Colors.RESET}")
            self.successful_picks += 1
            return True
        
        print(f"{Colors.BLUE}Cherry-picking commit: {commit_hash}{Colors.RESET}")
        
        # Get commit info for display
        try:
            result = self.run_git_command(["git", "show", "--oneline", "--no-patch", commit_hash])
            commit_info = result.stdout.strip()
            print(f"  {commit_info}")
        except CherryPickError:
            print(f"  {Colors.YELLOW}(Could not retrieve commit info){Colors.RESET}")
        
        # Attempt cherry-pick
        result = self.run_git_command(["git", "cherry-pick", commit_hash], check=False)
        
        if result.returncode == 0:
            print(f"  {Colors.GREEN}✓ Success{Colors.RESET}")
            self.successful_picks += 1
            return True
        else:
            # Check if cherry-pick is ready to continue (conflicts already resolved)
            if self.is_cherry_pick_ready_to_continue():
                print(f"  {Colors.GREEN}✓ Ready to continue{Colors.RESET}")
                # Continue the cherry-pick
                continue_result = self.run_git_command(["git", "cherry-pick", "--continue"], check=False)
                if continue_result.returncode == 0:
                    print(f"  {Colors.GREEN}✓ Continued successfully{Colors.RESET}")
                    self.successful_picks += 1
                    return True
                else:
                    print(f"  {Colors.RED}✗ Failed to continue: {continue_result.stderr.strip()}{Colors.RESET}")
                    self.failed_commits += 1
                    return False
            # Check if there are actual conflicts
            elif self.has_conflicts():
                print(f"  {Colors.YELLOW}⚠ Conflicts detected{Colors.RESET}")
                
                action = self.wait_for_user_confirmation(commit_hash)
                
                if action == 'continue':
                    print(f"  {Colors.GREEN}✓ Conflicts resolved{Colors.RESET}")
                    self.successful_picks += 1
                    return True
                elif action == 'skip':
                    print(f"  {Colors.MAGENTA}⊘ Skipped{Colors.RESET}")
                    # Abort the current cherry-pick
                    self.run_git_command(["git", "cherry-pick", "--abort"], check=False)
                    self.skipped_commits += 1
                    return False
                elif action == 'quit':
                    print(f"{Colors.RED}Process aborted by user.{Colors.RESET}")
                    sys.exit(0)
            else:
                print(f"  {Colors.RED}✗ Failed: {result.stderr.strip()}{Colors.RESET}")
                self.failed_commits += 1
                return False
    
    def parse_commits_file(self, file_path: str, start_from: Optional[str] = None) -> List[str]:
        """Parse commits from file, handling different formats."""
        commits = []
        
        try:
            with open(file_path, 'r') as f:
                content = f.read()
        except FileNotFoundError:
            raise CherryPickError(f"File not found: {file_path}")
        
        # Look for the "oldest first" section (for cherry-picking)
        lines = content.split('\n')
        in_oldest_first = False
        
        for line in lines:
            line = line.strip()
            
            # Skip empty lines
            if not line:
                continue
            
            # Look for section headers first (even in comments)
            if "oldest first" in line.lower():
                in_oldest_first = True
                continue
            elif "newest first" in line.lower() or line.startswith("Detailed"):
                in_oldest_first = False
                continue
            
            # Skip comments after checking for headers
            if line.startswith('#'):
                continue
            
            # Extract commit hashes
            if in_oldest_first:
                # Extract 7+ character hash from the beginning of the line
                hash_match = re.match(r'^([a-f0-9]{7,})', line)
                if hash_match:
                    commits.append(hash_match.group(1))
            elif not commits:  # Fallback if no "oldest first" section found
                hash_match = re.match(r'^([a-f0-9]{7,})', line)
                if hash_match:
                    commits.append(hash_match.group(1))
        
        if not commits:
            raise CherryPickError("No valid commit hashes found in the file")
        
        # If start_from is specified, find the starting point
        if start_from:
            try:
                start_index = commits.index(start_from)
                commits = commits[start_index:]
                print(f"{Colors.YELLOW}Starting from commit: {start_from}{Colors.RESET}")
            except ValueError:
                print(f"{Colors.YELLOW}Warning: Start commit {start_from} not found, starting from beginning{Colors.RESET}")
        
        return commits
    
    def run(self, commits_file: str, start_from: Optional[str] = None):
        """Main cherry-pick process."""
        print(f"{Colors.BOLD}Cherry-pick Script{Colors.RESET}")
        print(f"{'='*50}")
        
        # Check for ongoing operations first
        in_progress, operation = self.is_git_operation_in_progress()
        if in_progress:
            if not self.handle_ongoing_operation(operation):
                return
        
        # Parse commits
        try:
            commits = self.parse_commits_file(commits_file, start_from)
        except CherryPickError as e:
            print(f"{Colors.RED}Error: {e}{Colors.RESET}")
            sys.exit(1)
        
        self.total_commits = len(commits)
        print(f"\n{Colors.CYAN}Found {self.total_commits} commits to cherry-pick{Colors.RESET}")
        
        if self.dry_run:
            print(f"{Colors.YELLOW}Running in DRY RUN mode - no changes will be made{Colors.RESET}")
        
        # Process commits
        for i, commit in enumerate(commits, 1):
            print(f"\n{Colors.BOLD}Progress: {i}/{self.total_commits}{Colors.RESET}")
            
            # Check for ongoing operations before each commit
            in_progress, operation = self.is_git_operation_in_progress()
            if in_progress:
                print(f"{Colors.YELLOW}Detected ongoing {operation}, handling...{Colors.RESET}")
                if not self.handle_ongoing_operation(operation):
                    break
            
            self.cherry_pick_commit(commit)
        
        # Final summary
        self.print_summary()
    
    def print_summary(self):
        """Print final summary of the cherry-pick process."""
        print(f"\n{Colors.BOLD}{'='*50}{Colors.RESET}")
        print(f"{Colors.BOLD}Cherry-pick Summary{Colors.RESET}")
        print(f"{'='*50}")
        print(f"Total commits processed: {self.total_commits}")
        print(f"{Colors.GREEN}Successful: {self.successful_picks}{Colors.RESET}")
        if self.skipped_commits > 0:
            print(f"{Colors.MAGENTA}Skipped: {self.skipped_commits}{Colors.RESET}")
        if self.failed_commits > 0:
            print(f"{Colors.RED}Failed: {self.failed_commits}{Colors.RESET}")
        
        if self.successful_picks == self.total_commits:
            print(f"\n{Colors.GREEN}🎉 All commits successfully cherry-picked!{Colors.RESET}")
        elif self.successful_picks > 0:
            print(f"\n{Colors.YELLOW}⚠ Partial success - some commits had issues{Colors.RESET}")
        else:
            print(f"\n{Colors.RED}❌ No commits were successfully cherry-picked{Colors.RESET}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Cherry-pick commits with interactive conflict resolution",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s remote-only-commits.txt
  %(prog)s commits.txt --dry-run
  %(prog)s commits.txt --start-from=abc1234567
        """
    )
    
    parser.add_argument(
        "commits_file",
        help="File containing commit hashes to cherry-pick"
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )
    
    parser.add_argument(
        "--start-from",
        metavar="COMMIT",
        help="Start cherry-picking from a specific commit ID"
    )
    
    args = parser.parse_args()
    
    # Verify we're in a git repository
    try:
        result = subprocess.run(["git", "rev-parse", "--git-dir"], 
                              capture_output=True, text=True, check=True)
        git_dir = result.stdout.strip()
    except subprocess.CalledProcessError:
        print(f"{Colors.RED}Error: Not in a git repository{Colors.RESET}")
        sys.exit(1)
    
    # Create and run cherry picker
    cherry_picker = CherryPicker(dry_run=args.dry_run)
    
    try:
        cherry_picker.run(args.commits_file, args.start_from)
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Process interrupted by user{Colors.RESET}")
        sys.exit(1)
    except Exception as e:
        print(f"\n{Colors.RED}Unexpected error: {e}{Colors.RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()