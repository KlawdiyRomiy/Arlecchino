package indexer

func (r *CommandRegistry) registerGitCommands() {
	// Configuration
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "config",
		Description: "Get and set repository or global options",
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "checkout",
		Description: "Switch branches or restore files",
		OutputKind:  PendingBranch,
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "branch",
		Description: "List, create, or delete branches",
		OutputKind:  PendingBranch,
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "switch",
		Description: "Switch branches",
		OutputKind:  PendingBranch,
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "add",
		Description: "Add file contents to index",
		Flags: []FlagDef{
			{Name: "-A", Description: "Add all files"},
			{Name: "--all", Description: "Add all files"},
			{Name: "-u", Description: "Update tracked files"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-f", Description: "Force add ignored files"},
			{Name: "--force", Description: "Force add ignored files"},
			{Name: "-i", Description: "Interactive mode"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--intent-to-add", Short: "-N", Description: "Record intent to add"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "reset",
		Description: "Reset current HEAD",
		Flags: []FlagDef{
			{Name: "--soft", Description: "Keep changes staged"},
			{Name: "--mixed", Description: "Unstage changes"},
			{Name: "--hard", Description: "Discard all changes"},
			{Name: "--merge", Description: "Reset but keep unmerged"},
			{Name: "--keep", Description: "Reset but keep local changes"},
			{Name: "-p", Description: "Interactive patch mode"},
			{Name: "--patch", Description: "Interactive patch mode"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "restore",
		Description: "Restore working tree files",
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "rm",
		Description: "Remove files from working tree and index",
		Flags: []FlagDef{
			{Name: "--cached", Description: "Remove from index only"},
			{Name: "-f", Description: "Force removal"},
			{Name: "--force", Description: "Force removal"},
			{Name: "-r", Description: "Recursive removal"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "mv",
		Description: "Move or rename a file, directory or symlink",
		Flags: []FlagDef{
			{Name: "-f", Description: "Force move"},
			{Name: "--force", Description: "Force move"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-v", Description: "Verbose"},
		},
	})

	// Commits
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "commit",
		Description: "Record changes to repository",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "revert",
		Description: "Revert some existing commits",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "notes",
		Description: "Add or inspect object notes",
		Flags: []FlagDef{
			{Name: "add", Description: "Add note"},
			{Name: "edit", Description: "Edit note"},
			{Name: "show", Description: "Show note"},
			{Name: "remove", Description: "Remove note"},
			{Name: "list", Description: "List notes"},
			{Name: "--force", Short: "-f", Description: "Force"},
		},
	})

	// Remote operations
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "push",
		Description: "Update remote refs",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "pull",
		Description: "Fetch and integrate remote changes",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "fetch",
		Description: "Download objects and refs",
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "stash",
		Description: "Stash changes",
		OutputKind:  PendingStash,
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "merge",
		Description: "Join branches",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "rebase",
		Description: "Reapply commits on top of another base",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "cherry-pick",
		Description: "Apply commits from another branch",
		Flags: []FlagDef{
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
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "status",
		Description: "Show working tree status",
		Flags: []FlagDef{
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

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "log",
		Description: "Show commit logs",
		Flags: []FlagDef{
			{Name: "--oneline", Description: "One line per commit"},
			{Name: "--graph", Description: "Show branch graph"},
			{Name: "--all", Description: "Show all branches"},
			{Name: "-n", HasValue: true, Description: "Limit commits"},
			{Name: "--stat", Description: "Show stats"},
			{Name: "-p", Description: "Show patches"},
			{Name: "--patch", Description: "Show patches"},
			{Name: "--author", HasValue: true, Description: "Filter by author"},
			{Name: "--since", HasValue: true, Description: "Filter by date"},
			{Name: "--until", HasValue: true, Description: "Filter by end date"},
			{Name: "--after", HasValue: true, Description: "Filter by date"},
			{Name: "--before", HasValue: true, Description: "Filter by end date"},
			{Name: "--grep", HasValue: true, Description: "Filter by message"},
			{Name: "-S", HasValue: true, Description: "Search by content"},
			{Name: "--follow", Description: "Follow file renames"},
			{Name: "--decorate", Description: "Show ref names"},
			{Name: "--pretty", HasValue: true, Description: "Pretty format"},
			{Name: "--format", HasValue: true, Description: "Custom format"},
			{Name: "--abbrev-commit", Description: "Abbreviate SHA"},
			{Name: "--first-parent", Description: "Follow first parent only"},
			{Name: "--no-merges", Description: "Skip merge commits"},
			{Name: "--merges", Description: "Only merge commits"},
			{Name: "--name-only", Description: "Show filenames only"},
			{Name: "--name-status", Description: "Show filenames and status"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "show",
		Description: "Show various types of objects",
		Flags: []FlagDef{
			{Name: "--stat", Description: "Show stats"},
			{Name: "--name-only", Description: "Show filenames only"},
			{Name: "--name-status", Description: "Show filenames and status"},
			{Name: "--pretty", HasValue: true, Description: "Pretty format"},
			{Name: "--format", HasValue: true, Description: "Custom format"},
			{Name: "-p", Description: "Generate patch"},
			{Name: "--patch", Description: "Generate patch"},
			{Name: "--no-patch", Description: "Suppress patch output"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "diff",
		Description: "Show changes",
		Flags: []FlagDef{
			{Name: "--staged", Description: "Show staged changes"},
			{Name: "--cached", Description: "Show staged changes"},
			{Name: "--stat", Description: "Show stats"},
			{Name: "--numstat", Description: "Show numeric stats"},
			{Name: "--shortstat", Description: "Show short stats"},
			{Name: "--name-only", Description: "Show filenames only"},
			{Name: "--name-status", Description: "Show filenames and status"},
			{Name: "--color", Description: "Colored output"},
			{Name: "--no-color", Description: "No color"},
			{Name: "-w", Description: "Ignore whitespace"},
			{Name: "--ignore-all-space", Description: "Ignore all whitespace"},
			{Name: "--word-diff", Description: "Word diff"},
			{Name: "-U", HasValue: true, Description: "Context lines"},
			{Name: "--unified", HasValue: true, Description: "Context lines"},
			{Name: "--no-index", Description: "Compare files outside repo"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "difftool",
		Description: "Show changes using diff tool",
		Flags: []FlagDef{
			{Name: "-t", HasValue: true, Description: "Tool to use"},
			{Name: "--tool", HasValue: true, Description: "Tool to use"},
			{Name: "-d", Description: "Directory diff"},
			{Name: "--dir-diff", Description: "Directory diff"},
			{Name: "-y", Description: "Don't prompt"},
			{Name: "--no-prompt", Description: "Don't prompt"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "blame",
		Description: "Show what revision and author last modified each line",
		Flags: []FlagDef{
			{Name: "-L", HasValue: true, Description: "Line range"},
			{Name: "-l", Description: "Show full SHA"},
			{Name: "--date", HasValue: true, Description: "Date format"},
			{Name: "-e", Description: "Show email"},
			{Name: "-w", Description: "Ignore whitespace"},
			{Name: "-M", Description: "Detect moved lines"},
			{Name: "-C", Description: "Detect copied lines"},
			{Name: "--show-email", Description: "Show email"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "shortlog",
		Description: "Summarize git log output",
		Flags: []FlagDef{
			{Name: "-s", Description: "Suppress commit descriptions"},
			{Name: "--summary", Description: "Suppress commit descriptions"},
			{Name: "-n", Description: "Sort by number of commits"},
			{Name: "--numbered", Description: "Sort by number of commits"},
			{Name: "-e", Description: "Show email"},
			{Name: "--email", Description: "Show email"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "describe",
		Description: "Give an object a human readable name",
		Flags: []FlagDef{
			{Name: "--tags", Description: "Use any tag"},
			{Name: "--always", Description: "Show abbreviated SHA if no tag"},
			{Name: "--long", Description: "Always use long format"},
			{Name: "--abbrev", HasValue: true, Description: "Abbreviation length"},
			{Name: "--dirty", Description: "Describe working tree"},
			{Name: "--all", Description: "Use any ref"},
		},
	})

	// Tags
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "tag",
		Description: "Create, list, delete tags",
		OutputKind:  PendingTag,
		Flags: []FlagDef{
			{Name: "-a", Description: "Annotated tag"},
			{Name: "--annotate", Description: "Annotated tag"},
			{Name: "-s", Description: "Signed tag"},
			{Name: "--sign", Description: "Signed tag"},
			{Name: "-m", HasValue: true, Description: "Tag message"},
			{Name: "--message", HasValue: true, Description: "Tag message"},
			{Name: "-d", Description: "Delete tag"},
			{Name: "--delete", Description: "Delete tag"},
			{Name: "-l", Description: "List tags"},
			{Name: "--list", Description: "List tags"},
			{Name: "-f", Description: "Force replace"},
			{Name: "--force", Description: "Force replace"},
			{Name: "-v", Description: "Verify tag"},
			{Name: "--verify", Description: "Verify tag"},
			{Name: "-n", HasValue: true, Description: "Show lines of message"},
			{Name: "--sort", HasValue: true, Description: "Sort order"},
			{Name: "--contains", HasValue: true, Description: "List containing commit"},
		},
	})

	// Remote management
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "remote",
		Description: "Manage remote repositories",
		Flags: []FlagDef{
			{Name: "add", Description: "Add remote"},
			{Name: "remove", Description: "Remove remote"},
			{Name: "rename", Description: "Rename remote"},
			{Name: "set-url", Description: "Change remote URL"},
			{Name: "get-url", Description: "Get remote URL"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
			{Name: "show", Description: "Show remote info"},
			{Name: "prune", Description: "Prune stale branches"},
			{Name: "update", Description: "Update remotes"},
		},
	})

	// Clone & Init
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "clone",
		Description: "Clone a repository",
		Flags: []FlagDef{
			{Name: "--depth", HasValue: true, Description: "Shallow clone depth"},
			{Name: "--branch", Short: "-b", HasValue: true, Description: "Branch to clone"},
			{Name: "--single-branch", Description: "Clone single branch"},
			{Name: "--no-single-branch", Description: "Clone all branches"},
			{Name: "--recurse-submodules", Description: "Init submodules"},
			{Name: "--shallow-submodules", Description: "Shallow clone submodules"},
			{Name: "-o", HasValue: true, Description: "Remote name"},
			{Name: "--origin", HasValue: true, Description: "Remote name"},
			{Name: "--bare", Description: "Bare repository"},
			{Name: "--mirror", Description: "Mirror repository"},
			{Name: "-q", Description: "Quiet"},
			{Name: "--quiet", Description: "Quiet"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
			{Name: "--no-checkout", Description: "Skip checkout"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "init",
		Description: "Initialize repository",
		Flags: []FlagDef{
			{Name: "--bare", Description: "Create bare repository"},
			{Name: "-b", HasValue: true, Description: "Initial branch name"},
			{Name: "--initial-branch", HasValue: true, Description: "Initial branch name"},
			{Name: "-q", Description: "Quiet"},
			{Name: "--quiet", Description: "Quiet"},
		},
	})

	// Submodules
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "submodule",
		Description: "Initialize, update or inspect submodules",
		Flags: []FlagDef{
			{Name: "add", Description: "Add submodule"},
			{Name: "init", Description: "Initialize submodules"},
			{Name: "update", Description: "Update submodules"},
			{Name: "status", Description: "Submodule status"},
			{Name: "deinit", Description: "Deinit submodules"},
			{Name: "foreach", Description: "Run command in each submodule"},
			{Name: "sync", Description: "Sync submodule URLs"},
			{Name: "--init", Description: "Initialize uninitialized"},
			{Name: "--recursive", Description: "Recurse into nested"},
			{Name: "--remote", Description: "Use remote branch"},
		},
	})

	// Clean
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "clean",
		Description: "Remove untracked files",
		Flags: []FlagDef{
			{Name: "-f", Description: "Force"},
			{Name: "--force", Description: "Force"},
			{Name: "-d", Description: "Remove directories"},
			{Name: "-x", Description: "Remove ignored files"},
			{Name: "-X", Description: "Remove only ignored files"},
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "-i", Description: "Interactive"},
			{Name: "--interactive", Description: "Interactive"},
			{Name: "-e", HasValue: true, Description: "Exclude pattern"},
			{Name: "--exclude", HasValue: true, Description: "Exclude pattern"},
		},
	})

	// Debugging
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "bisect",
		Description: "Use binary search to find a bug",
		Flags: []FlagDef{
			{Name: "start", Description: "Start bisect"},
			{Name: "bad", Description: "Mark bad commit"},
			{Name: "good", Description: "Mark good commit"},
			{Name: "new", Description: "Mark new (for finding regression)"},
			{Name: "old", Description: "Mark old (for finding regression)"},
			{Name: "skip", Description: "Skip commit"},
			{Name: "reset", Description: "End bisect"},
			{Name: "log", Description: "Show bisect log"},
			{Name: "replay", Description: "Replay bisect log"},
			{Name: "run", Description: "Run test script"},
			{Name: "visualize", Description: "Visualize remaining"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "reflog",
		Description: "Manage reflog information",
		Flags: []FlagDef{
			{Name: "show", Description: "Show reflog"},
			{Name: "expire", Description: "Expire old entries"},
			{Name: "delete", Description: "Delete entry"},
			{Name: "--all", Description: "Process all refs"},
			{Name: "-n", HasValue: true, Description: "Limit entries"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "fsck",
		Description: "Verify connectivity and validity of objects",
		Flags: []FlagDef{
			{Name: "--unreachable", Description: "Show unreachable objects"},
			{Name: "--dangling", Description: "Show dangling objects"},
			{Name: "--full", Description: "Full check"},
			{Name: "--strict", Description: "Strict mode"},
		},
	})

	// Maintenance
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "gc",
		Description: "Cleanup unnecessary files and optimize repository",
		Flags: []FlagDef{
			{Name: "--aggressive", Description: "More aggressive optimization"},
			{Name: "--auto", Description: "Run if needed"},
			{Name: "--prune", HasValue: true, Description: "Prune objects older than"},
			{Name: "--quiet", Description: "Quiet"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "prune",
		Description: "Prune unreachable objects",
		Flags: []FlagDef{
			{Name: "-n", Description: "Dry run"},
			{Name: "--dry-run", Description: "Dry run"},
			{Name: "--expire", HasValue: true, Description: "Expire time"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
		},
	})

	// Archive
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "archive",
		Description: "Create an archive of files from a tree",
		Flags: []FlagDef{
			{Name: "--format", HasValue: true, Description: "Archive format (zip, tar)"},
			{Name: "--output", Short: "-o", HasValue: true, Description: "Output file"},
			{Name: "--prefix", HasValue: true, Description: "Prepend prefix to paths"},
			{Name: "--list", Description: "List supported formats"},
		},
	})

	// Search
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "grep",
		Description: "Search for patterns in tracked files",
		Flags: []FlagDef{
			{Name: "-n", Description: "Show line numbers"},
			{Name: "--line-number", Description: "Show line numbers"},
			{Name: "-c", Description: "Show count only"},
			{Name: "--count", Description: "Show count only"},
			{Name: "-i", Description: "Case insensitive"},
			{Name: "--ignore-case", Description: "Case insensitive"},
			{Name: "-w", Description: "Match whole word"},
			{Name: "--word-regexp", Description: "Match whole word"},
			{Name: "-v", Description: "Invert match"},
			{Name: "--invert-match", Description: "Invert match"},
			{Name: "-e", HasValue: true, Description: "Pattern"},
			{Name: "--cached", Description: "Search in index"},
		},
	})

	// Worktree
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "worktree",
		Description: "Manage multiple working trees",
		Flags: []FlagDef{
			{Name: "add", Description: "Add worktree"},
			{Name: "list", Description: "List worktrees"},
			{Name: "remove", Description: "Remove worktree"},
			{Name: "prune", Description: "Prune worktree info"},
			{Name: "-b", HasValue: true, Description: "Create new branch"},
			{Name: "--detach", Description: "Detach HEAD"},
			{Name: "--force", Description: "Force"},
		},
	})

	// Patching
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "apply",
		Description: "Apply a patch to files",
		Flags: []FlagDef{
			{Name: "--check", Description: "Check if patch applies"},
			{Name: "--stat", Description: "Show stats"},
			{Name: "--numstat", Description: "Show numeric stats"},
			{Name: "--summary", Description: "Show summary"},
			{Name: "-v", Description: "Verbose"},
			{Name: "--verbose", Description: "Verbose"},
			{Name: "--index", Description: "Apply to index"},
			{Name: "--cached", Description: "Apply to index only"},
			{Name: "-3", Description: "3-way merge"},
			{Name: "--3way", Description: "3-way merge"},
			{Name: "--reverse", Short: "-R", Description: "Reverse patch"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "format-patch",
		Description: "Prepare patches for e-mail submission",
		Flags: []FlagDef{
			{Name: "-o", HasValue: true, Description: "Output directory"},
			{Name: "--output-directory", HasValue: true, Description: "Output directory"},
			{Name: "--stdout", Description: "Print to stdout"},
			{Name: "-n", HasValue: true, Description: "Limit patches"},
			{Name: "--cover-letter", Description: "Generate cover letter"},
			{Name: "--signoff", Short: "-s", Description: "Add signoff"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "am",
		Description: "Apply patches from a mailbox",
		Flags: []FlagDef{
			{Name: "-3", Description: "3-way merge"},
			{Name: "--3way", Description: "3-way merge"},
			{Name: "--signoff", Short: "-s", Description: "Add signoff"},
			{Name: "--abort", Description: "Abort operation"},
			{Name: "--continue", Description: "Continue operation"},
			{Name: "--skip", Description: "Skip patch"},
		},
	})

	// Low-level commands
	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "ls-files",
		Description: "Show information about files in index and working tree",
		Flags: []FlagDef{
			{Name: "--cached", Short: "-c", Description: "Show cached files"},
			{Name: "--deleted", Short: "-d", Description: "Show deleted files"},
			{Name: "--modified", Short: "-m", Description: "Show modified files"},
			{Name: "--others", Short: "-o", Description: "Show untracked files"},
			{Name: "--ignored", Short: "-i", Description: "Show ignored files"},
			{Name: "--stage", Short: "-s", Description: "Show staged entries"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "ls-tree",
		Description: "List the contents of a tree object",
		Flags: []FlagDef{
			{Name: "-r", Description: "Recurse into subtrees"},
			{Name: "-t", Description: "Show trees"},
			{Name: "-d", Description: "Show only trees"},
			{Name: "-l", Description: "Show long format"},
			{Name: "--long", Description: "Show long format"},
			{Name: "--name-only", Description: "Show names only"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "ls-remote",
		Description: "List references in a remote repository",
		Flags: []FlagDef{
			{Name: "--heads", Short: "-h", Description: "Show heads"},
			{Name: "--tags", Short: "-t", Description: "Show tags"},
			{Name: "--refs", Description: "Show refs"},
			{Name: "--get-url", Description: "Show URL"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "rev-parse",
		Description: "Parse revision identifiers",
		Flags: []FlagDef{
			{Name: "--abbrev-ref", Description: "Abbreviate ref"},
			{Name: "--short", Description: "Short SHA"},
			{Name: "--verify", Description: "Verify ref"},
			{Name: "--git-dir", Description: "Show git dir"},
			{Name: "--show-toplevel", Description: "Show top-level dir"},
			{Name: "--is-inside-work-tree", Description: "Check if in work tree"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "cat-file",
		Description: "Provide content or type of repository objects",
		Flags: []FlagDef{
			{Name: "-t", Description: "Show object type"},
			{Name: "-s", Description: "Show object size"},
			{Name: "-e", Description: "Check if object exists"},
			{Name: "-p", Description: "Pretty-print object"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "rerere",
		Description: "Reuse recorded resolution",
		Flags: []FlagDef{
			{Name: "clear", Description: "Clear recorded resolutions"},
			{Name: "forget", Description: "Forget resolution"},
			{Name: "status", Description: "Show status"},
			{Name: "diff", Description: "Show diff"},
			{Name: "gc", Description: "Garbage collect"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "rev-list",
		Description: "List commit objects in reverse chronological order",
		Flags: []FlagDef{
			{Name: "--count", Description: "Show count only"},
			{Name: "--all", Description: "All refs"},
			{Name: "--max-count", Short: "-n", HasValue: true, Description: "Limit commits"},
			{Name: "--since", HasValue: true, Description: "Commits after date"},
			{Name: "--until", HasValue: true, Description: "Commits before date"},
			{Name: "--first-parent", Description: "Follow first parent only"},
			{Name: "--no-merges", Description: "Skip merge commits"},
		},
	})

	r.Register(&CommandDef{
		Prefix:      "git",
		Name:        "merge-base",
		Description: "Find common ancestors of commits",
		Flags: []FlagDef{
			{Name: "--all", Description: "Output all merge bases"},
			{Name: "--octopus", Description: "Compute octopus merge base"},
			{Name: "--is-ancestor", Description: "Check if first is ancestor"},
		},
	})
}
