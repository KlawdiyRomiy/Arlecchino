package common

import "arlecchino/internal/plugins"

func (p *Plugin) registerGitCommands() {
	// Configuration
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "config",
		Description: "Get and set repository or global options",
		Flags: []plugins.FlagDef{
			{Name: "--global", Description: "Use global config"},
			{Name: "--local", Description: "Use local config"},
			{Name: "--system", Description: "Use system config"},
			{Name: "--list", Short: "-l", Description: "List all config"},
			{Name: "--edit", Short: "-e", Description: "Edit config file"},
			{Name: "--unset", Description: "Remove setting"},
			{Name: "--get", Description: "Get value"},
			{Name: "--add", Description: "Add value"},
		},
	})

	// Branch operations
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "checkout",
		Description: "Switch branches or restore files",
		OutputKind:  "branch",
		Flags: []plugins.FlagDef{
			{Name: "-b", Description: "Create and switch to new branch"},
			{Name: "-B", Description: "Create/reset and switch to branch"},
			{Name: "--track", Short: "-t", Description: "Set up tracking"},
			{Name: "--orphan", Description: "Create orphan branch"},
			{Name: "--force", Short: "-f", Description: "Force checkout"},
			{Name: "--merge", Short: "-m", Description: "Merge local changes"},
			{Name: "--detach", Description: "Detach HEAD"},
			{Name: "--ours", Description: "Take ours version"},
			{Name: "--theirs", Description: "Take theirs version"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "branch",
		Description: "List, create, or delete branches",
		OutputKind:  "branch",
		Flags: []plugins.FlagDef{
			{Name: "-d", Description: "Delete branch"},
			{Name: "-D", Description: "Force delete branch"},
			{Name: "-m", Description: "Move/rename branch"},
			{Name: "-M", Description: "Force move/rename branch"},
			{Name: "-c", Description: "Copy branch"},
			{Name: "-C", Description: "Force copy branch"},
			{Name: "-a", Description: "List all branches"},
			{Name: "-r", Description: "List remote branches"},
			{Name: "-v", Description: "Verbose output"},
			{Name: "-vv", Description: "More verbose output"},
			{Name: "--list", Description: "List branches matching pattern"},
			{Name: "--merged", Description: "List merged branches"},
			{Name: "--no-merged", Description: "List unmerged branches"},
			{Name: "--set-upstream-to", Short: "-u", HasValue: true, Description: "Set upstream"},
			{Name: "--unset-upstream", Description: "Remove upstream"},
			{Name: "--contains", HasValue: true, Description: "List containing commit"},
			{Name: "--sort", HasValue: true, Description: "Sort branches"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "switch",
		Description: "Switch branches",
		OutputKind:  "branch",
		Flags: []plugins.FlagDef{
			{Name: "-c", Description: "Create and switch to new branch"},
			{Name: "-C", Description: "Create/reset and switch"},
			{Name: "--detach", Short: "-d", Description: "Detach HEAD"},
			{Name: "--force", Short: "-f", Description: "Force switch"},
			{Name: "--discard-changes", Description: "Discard local changes"},
			{Name: "--guess", Description: "Guess branch name"},
			{Name: "--no-guess", Description: "Don't guess branch name"},
		},
	})

	// Staging
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "add",
		Description: "Add file contents to index",
		Flags: []plugins.FlagDef{
			{Name: "-A", Description: "Add all files"},
			{Name: "--all", Description: "Add all files"},
			{Name: "-u", Description: "Update tracked files"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-f", Description: "Force add ignored files"},
			{Name: "--force", Description: "Force add ignored files"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--intent-to-add", Short: "-N", Description: "Record intent to add"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "reset",
		Description: "Reset current HEAD",
		Flags: []plugins.FlagDef{
			{Name: "--soft", Description: "Keep changes staged"},
			{Name: "--mixed", Description: "Unstage changes"},
			{Name: "--hard", Description: "Discard all changes"},
			{Name: "--merge", Description: "Reset but keep unmerged"},
			{Name: "--keep", Description: "Reset but keep local changes"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "restore",
		Description: "Restore working tree files",
		Flags: []plugins.FlagDef{
			{Name: "--staged", Short: "-S", Description: "Restore staged files"},
			{Name: "--worktree", Short: "-W", Description: "Restore worktree"},
			{Name: "--source", Short: "-s", HasValue: true, Description: "Restore from source"},
			{Name: "--ours", Description: "Take ours version"},
			{Name: "--theirs", Description: "Take theirs version"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
		},
	})

	// File operations
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "rm",
		Description: "Remove files from working tree and index",
		Flags: []plugins.FlagDef{
			{Name: "--cached", Description: "Remove from index only"},
			{Name: "-f", Description: "Force removal"},
			{Name: "--force", Description: "Force removal"},
			{Name: "-r", Description: "Recursive removal"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "mv",
		Description: "Move or rename a file, directory or symlink",
		Flags: []plugins.FlagDef{
			{Name: "-f", Description: "Force move"},
			{Name: "--force", Description: "Force move"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-v", Description: "Verbose"},
		},
	})

	// Commits
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "commit",
		Description: "Record changes to repository",
		Flags: []plugins.FlagDef{
			{Name: "-m", HasValue: true, Description: "Commit message"},
			{Name: "-a", Description: "Stage all modified files"},
			{Name: "--all", Description: "Stage all modified files"},
			{Name: "--amend", Description: "Amend previous commit"},
			{Name: "--no-edit", Description: "Don't edit message"},
			{Name: "-v", Description: "Show diff in editor"},
			{Name: "--verbose", Description: "Show diff in editor"},
			{Name: "-S", Description: "GPG sign commit"},
			{Name: "--gpg-sign", Description: "GPG sign commit"},
			{Name: "--allow-empty", Description: "Allow empty commit"},
			{Name: "--allow-empty-message", Description: "Allow empty message"},
			{Name: "-c", HasValue: true, Description: "Reuse commit message"},
			{Name: "-C", HasValue: true, Description: "Reuse commit message exactly"},
			{Name: "--fixup", HasValue: true, Description: "Create fixup commit"},
			{Name: "--squash", HasValue: true, Description: "Create squash commit"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--author", HasValue: true, Description: "Override author"},
			{Name: "--date", HasValue: true, Description: "Override date"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "revert",
		Description: "Revert some existing commits",
		Flags: []plugins.FlagDef{
			{Name: "-n", Description: "Don't commit"},
			{Name: "--no-commit", Description: "Don't commit"},
			{Name: "-e", Description: "Edit commit message"},
			{Name: "--edit", Description: "Edit commit message"},
			{Name: "--no-edit", Description: "Don't edit message"},
			{Name: "-m", HasValue: true, Description: "Parent number for merge"},
			{Name: "--mainline", HasValue: true, Description: "Parent number for merge"},
			{Name: "--abort", Description: "Abort revert"},
			{Name: "--continue", Description: "Continue revert"},
			{Name: "--skip", Description: "Skip commit"},
		},
	})

	// Remote operations
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "push",
		Description: "Update remote refs",
		Flags: []plugins.FlagDef{
			{Name: "-u", Description: "Set upstream"},
			{Name: "--set-upstream", Description: "Set upstream"},
			{Name: "--force", Short: "-f", Description: "Force push"},
			{Name: "--force-with-lease", Description: "Safe force push"},
			{Name: "--all", Description: "Push all branches"},
			{Name: "--tags", Description: "Push tags"},
			{Name: "--delete", Short: "-d", Description: "Delete remote branch"},
			{Name: "--dry-run", Short: "-n", Description: "Dry run"},
			{Name: "--prune", Description: "Remove remote refs not locally"},
			{Name: "--mirror", Description: "Mirror all refs"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "pull",
		Description: "Fetch and integrate remote changes",
		Flags: []plugins.FlagDef{
			{Name: "--rebase", Short: "-r", Description: "Rebase instead of merge"},
			{Name: "--no-rebase", Description: "Merge instead of rebase"},
			{Name: "--ff-only", Description: "Fast-forward only"},
			{Name: "--no-ff", Description: "Create merge commit"},
			{Name: "--autostash", Description: "Auto stash/pop"},
			{Name: "--squash", Description: "Squash commits"},
			{Name: "--no-commit", Description: "Don't commit"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "fetch",
		Description: "Download objects and refs",
		Flags: []plugins.FlagDef{
			{Name: "--all", Description: "Fetch all remotes"},
			{Name: "--prune", Short: "-p", Description: "Prune remote branches"},
			{Name: "--prune-tags", Short: "-P", Description: "Prune remote tags"},
			{Name: "--tags", Short: "-t", Description: "Fetch tags"},
			{Name: "--no-tags", Description: "Don't fetch tags"},
			{Name: "--depth", HasValue: true, Description: "Shallow fetch depth"},
			{Name: "--unshallow", Description: "Convert to complete repo"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
		},
	})

	// Stash
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "stash",
		Description: "Stash changes",
		OutputKind:  "stash",
		Flags: []plugins.FlagDef{
			{Name: "push", Description: "Stash changes"},
			{Name: "pop", Description: "Apply and remove stash"},
			{Name: "apply", Description: "Apply stash"},
			{Name: "drop", Description: "Remove stash"},
			{Name: "list", Description: "List stashes"},
			{Name: "show", Description: "Show stash"},
			{Name: "clear", Description: "Clear all stashes"},
			{Name: "branch", Description: "Create branch from stash"},
			{Name: "-u", Description: "Include untracked"},
			{Name: "--include-untracked", Description: "Include untracked"},
			{Name: "-a", Description: "Include ignored"},
			{Name: "--all", Description: "Include ignored"},
			{Name: "-m", HasValue: true, Description: "Stash message"},
			{Name: "--message", HasValue: true, Description: "Stash message"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
			{Name: "-k", Description: "Keep index"},
			{Name: "--keep-index", Description: "Keep index"},
		},
	})

	// Merge & Rebase
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "merge",
		Description: "Join branches",
		Flags: []plugins.FlagDef{
			{Name: "--no-ff", Description: "Create merge commit"},
			{Name: "--ff-only", Description: "Fast-forward only"},
			{Name: "--ff", Description: "Allow fast-forward"},
			{Name: "--squash", Description: "Squash commits"},
			{Name: "--abort", Description: "Abort merge"},
			{Name: "--continue", Description: "Continue merge"},
			{Name: "--quit", Description: "Quit merge"},
			{Name: "-m", HasValue: true, Description: "Merge message"},
			{Name: "--no-commit", Description: "Don't commit"},
			{Name: "--strategy", Short: "-s", HasValue: true, Description: "Merge strategy"},
			{Name: "-X", HasValue: true, Description: "Strategy option"},
			{Name: "--allow-unrelated-histories", Description: "Allow unrelated histories"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "rebase",
		Description: "Reapply commits on top of another base",
		Flags: []plugins.FlagDef{
			{Name: "-i", Description: "Interactive rebase"},
			{Name: "--interactive", Description: "Interactive rebase"},
			{Name: "--onto", HasValue: true, Description: "Rebase onto"},
			{Name: "--abort", Description: "Abort rebase"},
			{Name: "--continue", Description: "Continue rebase"},
			{Name: "--skip", Description: "Skip commit"},
			{Name: "--quit", Description: "Quit rebase"},
			{Name: "--autostash", Description: "Auto stash/pop"},
			{Name: "--autosquash", Description: "Auto squash fixups"},
			{Name: "--keep-empty", Description: "Keep empty commits"},
			{Name: "-x", HasValue: true, Description: "Exec command"},
			{Name: "--exec", HasValue: true, Description: "Exec command"},
			{Name: "-r", Description: "Rebase merges"},
			{Name: "--rebase-merges", Description: "Rebase merges"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "cherry-pick",
		Description: "Apply commits from another branch",
		Flags: []plugins.FlagDef{
			{Name: "-n", Description: "Don't commit"},
			{Name: "--no-commit", Description: "Don't commit"},
			{Name: "-e", Description: "Edit commit message"},
			{Name: "--edit", Description: "Edit commit message"},
			{Name: "-x", Description: "Append commit reference"},
			{Name: "--signoff", Short: "-s", Description: "Add signoff"},
			{Name: "-m", HasValue: true, Description: "Parent number for merge"},
			{Name: "--mainline", HasValue: true, Description: "Parent number for merge"},
			{Name: "--abort", Description: "Abort cherry-pick"},
			{Name: "--continue", Description: "Continue cherry-pick"},
			{Name: "--skip", Description: "Skip commit"},
			{Name: "--quit", Description: "Quit cherry-pick"},
		},
	})

	// Status & Log
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "status",
		Description: "Show working tree status",
		Flags: []plugins.FlagDef{
			{Name: "-s", Description: "Short format"},
			{Name: "--short", Description: "Short format"},
			{Name: "-b", Description: "Show branch info"},
			{Name: "--branch", Description: "Show branch info"},
			{Name: "--porcelain", Description: "Machine-readable output"},
			{Name: "-u", Description: "Show untracked files"},
			{Name: "--untracked-files", HasValue: true, Description: "Untracked files mode"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
			{Name: "--ignored", Description: "Show ignored files"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "log",
		Description: "Show commit logs",
		Flags: []plugins.FlagDef{
			{Name: "--oneline", Description: "One line per commit"},
			{Name: "--graph", Description: "Show branch graph"},
			{Name: "--all", Description: "Show all branches"},
			{Name: "-n", HasValue: true, Description: "Limit commits"},
			{Name: "--stat", Description: "Show stats"},
			{Name: "-p", Description: "Show patches"},
			{Name: "--patch", Description: "Show patches"},
			{Name: "--author", HasValue: true, Description: "Filter by author"},
			{Name: "--since", HasValue: true, Description: "Filter by date"},
			{Name: "--until", HasValue: true, Description: "Filter by date"},
			{Name: "--after", HasValue: true, Description: "Filter by date"},
			{Name: "--before", HasValue: true, Description: "Filter by date"},
			{Name: "--grep", HasValue: true, Description: "Filter by message"},
			{Name: "--no-merges", Description: "Skip merge commits"},
			{Name: "--merges", Description: "Only merge commits"},
			{Name: "--first-parent", Description: "Follow first parent only"},
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--pretty", HasValue: true, Description: "Output format"},
			{Name: "--abbrev-commit", Description: "Abbreviated commits"},
			{Name: "--follow", Description: "Follow file history"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "show",
		Description: "Show various types of objects",
		Flags: []plugins.FlagDef{
			{Name: "--stat", Description: "Show stats"},
			{Name: "-p", Description: "Show patches"},
			{Name: "--patch", Description: "Show patches"},
			{Name: "--name-only", Description: "Show only names"},
			{Name: "--name-status", Description: "Show names and status"},
			{Name: "--format", HasValue: true, Description: "Output format"},
			{Name: "--pretty", HasValue: true, Description: "Output format"},
			{Name: "--abbrev-commit", Description: "Abbreviated commits"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "diff",
		Description: "Show changes between commits, commit and working tree, etc",
		Flags: []plugins.FlagDef{
			{Name: "--staged", Description: "Diff staged changes"},
			{Name: "--cached", Description: "Diff staged changes"},
			{Name: "--stat", Description: "Show stats"},
			{Name: "--name-only", Description: "Show only names"},
			{Name: "--name-status", Description: "Show names and status"},
			{Name: "--no-index", Description: "Compare files outside repo"},
			{Name: "-w", Description: "Ignore whitespace"},
			{Name: "--ignore-all-space", Description: "Ignore whitespace"},
			{Name: "-b", Description: "Ignore space changes"},
			{Name: "--ignore-space-change", Description: "Ignore space changes"},
			{Name: "--word-diff", Description: "Word-based diff"},
			{Name: "--color-words", Description: "Color word diff"},
			{Name: "-U", HasValue: true, Description: "Context lines"},
			{Name: "--unified", HasValue: true, Description: "Context lines"},
		},
	})

	// Remote management
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "remote",
		Description: "Manage set of tracked repositories",
		Flags: []plugins.FlagDef{
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
			{Name: "add", Description: "Add remote"},
			{Name: "remove", Description: "Remove remote"},
			{Name: "rename", Description: "Rename remote"},
			{Name: "set-url", Description: "Set remote URL"},
			{Name: "get-url", Description: "Get remote URL"},
			{Name: "show", Description: "Show remote details"},
			{Name: "prune", Description: "Remove stale refs"},
		},
	})

	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "clone",
		Description: "Clone a repository",
		Flags: []plugins.FlagDef{
			{Name: "--depth", HasValue: true, Description: "Shallow clone depth"},
			{Name: "--shallow-since", HasValue: true, Description: "Shallow clone since date"},
			{Name: "--single-branch", Description: "Clone single branch"},
			{Name: "--branch", Short: "-b", HasValue: true, Description: "Clone specific branch"},
			{Name: "--bare", Description: "Create bare repo"},
			{Name: "--mirror", Description: "Create mirror"},
			{Name: "--recurse-submodules", Description: "Clone submodules"},
			{Name: "--shallow-submodules", Description: "Shallow submodules"},
			{Name: "--no-checkout", Description: "Don't checkout"},
			{Name: "-o", HasValue: true, Description: "Remote name"},
			{Name: "--origin", HasValue: true, Description: "Remote name"},
		},
	})

	// Tags
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "tag",
		Description: "Create, list, delete or verify a tag",
		OutputKind:  "tag",
		Flags: []plugins.FlagDef{
			{Name: "-a", Description: "Annotated tag"},
			{Name: "--annotate", Description: "Annotated tag"},
			{Name: "-m", HasValue: true, Description: "Tag message"},
			{Name: "--message", HasValue: true, Description: "Tag message"},
			{Name: "-d", Description: "Delete tag"},
			{Name: "--delete", Description: "Delete tag"},
			{Name: "-l", Description: "List tags"},
			{Name: "--list", Description: "List tags"},
			{Name: "-f", Description: "Force"},
			{Name: "--force", Description: "Force"},
			{Name: "-s", Description: "Sign tag"},
			{Name: "--sign", Description: "Sign tag"},
			{Name: "-v", Description: "Verify tag"},
			{Name: "--verify", Description: "Verify tag"},
			{Name: "--sort", HasValue: true, Description: "Sort order"},
			{Name: "--contains", HasValue: true, Description: "Tags containing commit"},
		},
	})

	// Init
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "init",
		Description: "Create an empty Git repository",
		Flags: []plugins.FlagDef{
			{Name: "--bare", Description: "Create bare repo"},
			{Name: "-b", HasValue: true, Description: "Initial branch name"},
			{Name: "--initial-branch", HasValue: true, Description: "Initial branch name"},
			{Name: "--template", HasValue: true, Description: "Template directory"},
			{Name: "--separate-git-dir", HasValue: true, Description: "Git dir location"},
		},
	})

	// Clean
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "clean",
		Description: "Remove untracked files from working tree",
		Flags: []plugins.FlagDef{
			{Name: "-d", Description: "Remove directories"},
			{Name: "-f", Description: "Force"},
			{Name: "--force", Description: "Force"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-x", Description: "Remove ignored files too"},
			{Name: "-X", Description: "Remove only ignored files"},
			{Name: "-i", Description: "Interactive mode"},
			{Name: "--interactive", Description: "Interactive mode"},
		},
	})

	// Blame
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "blame",
		Description: "Show what revision and author last modified each line",
		Flags: []plugins.FlagDef{
			{Name: "-L", HasValue: true, Description: "Line range"},
			{Name: "-l", Description: "Long format"},
			{Name: "-s", Description: "Suppress author name"},
			{Name: "-e", Description: "Show author email"},
			{Name: "--show-email", Description: "Show author email"},
			{Name: "-w", Description: "Ignore whitespace"},
			{Name: "-M", Description: "Detect moved lines"},
			{Name: "-C", Description: "Detect copied lines"},
		},
	})

	// Worktree
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "worktree",
		Description: "Manage multiple working trees",
		Flags: []plugins.FlagDef{
			{Name: "add", Description: "Add worktree"},
			{Name: "list", Description: "List worktrees"},
			{Name: "lock", Description: "Lock worktree"},
			{Name: "unlock", Description: "Unlock worktree"},
			{Name: "move", Description: "Move worktree"},
			{Name: "remove", Description: "Remove worktree"},
			{Name: "prune", Description: "Prune stale worktrees"},
			{Name: "-b", HasValue: true, Description: "Create new branch"},
			{Name: "-B", HasValue: true, Description: "Create/reset branch"},
			{Name: "--detach", Description: "Detach HEAD"},
			{Name: "-f", Description: "Force"},
			{Name: "--force", Description: "Force"},
		},
	})

	// Submodule
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "submodule",
		Description: "Initialize, update or inspect submodules",
		Flags: []plugins.FlagDef{
			{Name: "add", Description: "Add submodule"},
			{Name: "init", Description: "Initialize submodules"},
			{Name: "update", Description: "Update submodules"},
			{Name: "status", Description: "Show submodule status"},
			{Name: "summary", Description: "Show submodule summary"},
			{Name: "foreach", Description: "Execute command in each"},
			{Name: "sync", Description: "Sync submodule URLs"},
			{Name: "deinit", Description: "Deinit submodule"},
			{Name: "--init", Description: "Initialize submodules"},
			{Name: "--recursive", Description: "Recursive update"},
			{Name: "--remote", Description: "Update to remote tracking"},
			{Name: "--force", Short: "-f", Description: "Force"},
		},
	})

	// Bisect
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "bisect",
		Description: "Use binary search to find the commit that introduced a bug",
		Flags: []plugins.FlagDef{
			{Name: "start", Description: "Start bisect"},
			{Name: "good", Description: "Mark commit as good"},
			{Name: "bad", Description: "Mark commit as bad"},
			{Name: "old", Description: "Mark commit as old"},
			{Name: "new", Description: "Mark commit as new"},
			{Name: "skip", Description: "Skip commit"},
			{Name: "reset", Description: "Finish bisect"},
			{Name: "run", Description: "Run script on each"},
			{Name: "log", Description: "Show bisect log"},
			{Name: "replay", Description: "Replay bisect log"},
		},
	})

	// Reflog
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "reflog",
		Description: "Manage reflog information",
		Flags: []plugins.FlagDef{
			{Name: "show", Description: "Show reflog"},
			{Name: "expire", Description: "Expire old entries"},
			{Name: "delete", Description: "Delete entries"},
			{Name: "--all", Description: "Process all refs"},
			{Name: "-n", HasValue: true, Description: "Limit entries"},
		},
	})

	// Shortlog
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "shortlog",
		Description: "Summarize git log output",
		Flags: []plugins.FlagDef{
			{Name: "-s", Description: "Summary only"},
			{Name: "--summary", Description: "Summary only"},
			{Name: "-n", Description: "Sort by number"},
			{Name: "--numbered", Description: "Sort by number"},
			{Name: "-e", Description: "Show email"},
			{Name: "--email", Description: "Show email"},
			{Name: "--group", HasValue: true, Description: "Group by field"},
		},
	})

	// Describe
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "describe",
		Description: "Give an object a human readable name based on an available ref",
		Flags: []plugins.FlagDef{
			{Name: "--tags", Description: "Use any tag"},
			{Name: "--all", Description: "Use any ref"},
			{Name: "--long", Description: "Long format"},
			{Name: "--abbrev", HasValue: true, Description: "Abbreviation length"},
			{Name: "--exact-match", Description: "Match exactly"},
			{Name: "--always", Description: "Always show abbreviated commit"},
			{Name: "--dirty", Description: "Describe working tree"},
		},
	})

	// Rev-parse
	p.registry.Register(&plugins.CommandDef{
		Prefix:      "git",
		Name:        "rev-parse",
		Description: "Pick out and massage parameters",
		Flags: []plugins.FlagDef{
			{Name: "--short", Description: "Short SHA"},
			{Name: "--verify", Description: "Verify it's a valid object"},
			{Name: "--abbrev-ref", Description: "Abbreviated ref name"},
			{Name: "--symbolic", Description: "Symbolic output"},
			{Name: "--symbolic-full-name", Description: "Full symbolic name"},
			{Name: "--git-dir", Description: "Show .git directory"},
			{Name: "--show-toplevel", Description: "Show top-level directory"},
			{Name: "--show-prefix", Description: "Show relative prefix"},
			{Name: "--is-inside-work-tree", Description: "Is inside work tree"},
		},
	})
}
