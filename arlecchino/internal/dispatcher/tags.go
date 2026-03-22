package dispatcher

import (
	"sync"
)

type TagRegistry struct {
	mu   sync.RWMutex
	tags map[string]*TagDefinition
}

func NewTagRegistry() *TagRegistry {
	r := &TagRegistry{
		tags: make(map[string]*TagDefinition),
	}
	r.registerDefaults()
	return r
}

func (r *TagRegistry) registerDefaults() {
	defaults := []TagDefinition{
		{Name: "a", Expansion: "php artisan", Description: "Laravel Artisan", Framework: "laravel"},
		{Name: "artisan", Expansion: "php artisan", Description: "Laravel Artisan", Framework: "laravel"},
		{Name: "c", Expansion: "composer", Description: "Composer", Framework: "php"},
		{Name: "composer", Expansion: "composer", Description: "Composer", Framework: "php"},

		{Name: "g", Expansion: "git", Description: "Git", Framework: ""},
		{Name: "git", Expansion: "git", Description: "Git", Framework: ""},

		{Name: "go", Expansion: "go", Description: "Go toolchain", Framework: "go"},

		{Name: "py", Expansion: "python", Description: "Python", Framework: "python"},
		{Name: "python", Expansion: "python", Description: "Python", Framework: "python"},
		{Name: "pip", Expansion: "pip", Description: "Python pip", Framework: "python"},

		{Name: "dj", Expansion: "python manage.py", Description: "Django manage.py", Framework: "django"},
		{Name: "django", Expansion: "python manage.py", Description: "Django manage.py", Framework: "django"},
		{Name: "manage", Expansion: "python manage.py", Description: "Django manage.py", Framework: "django"},

		{Name: "rails", Expansion: "rails", Description: "Ruby on Rails", Framework: "rails"},
		{Name: "rake", Expansion: "rake", Description: "Ruby Rake", Framework: "ruby"},
		{Name: "bundle", Expansion: "bundle", Description: "Ruby Bundler", Framework: "ruby"},

		{Name: "rs", Expansion: "cargo", Description: "Rust Cargo", Framework: "rust"},
		{Name: "cargo", Expansion: "cargo", Description: "Rust Cargo", Framework: "rust"},
		{Name: "rustc", Expansion: "rustc", Description: "Rust compiler", Framework: "rust"},

		{Name: "npm", Expansion: "npm", Description: "Node npm", Framework: "node"},
		{Name: "yarn", Expansion: "yarn", Description: "Node Yarn", Framework: "node"},
		{Name: "pnpm", Expansion: "pnpm", Description: "Node pnpm", Framework: "node"},
		{Name: "bun", Expansion: "bun", Description: "Bun runtime", Framework: "node"},
		{Name: "npx", Expansion: "npx", Description: "Node npx", Framework: "node"},

		{Name: "docker", Expansion: "docker", Description: "Docker", Framework: "docker"},
		{Name: "dc", Expansion: "docker compose", Description: "Docker Compose", Framework: "docker"},
		{Name: "compose", Expansion: "docker compose", Description: "Docker Compose", Framework: "docker"},

		{Name: "k8s", Expansion: "kubectl", Description: "Kubernetes", Framework: "kubernetes"},
		{Name: "kubectl", Expansion: "kubectl", Description: "Kubernetes", Framework: "kubernetes"},
		{Name: "helm", Expansion: "helm", Description: "Helm", Framework: "kubernetes"},

		{Name: "tf", Expansion: "terraform", Description: "Terraform", Framework: "terraform"},
		{Name: "terraform", Expansion: "terraform", Description: "Terraform", Framework: "terraform"},

		{Name: "gradle", Expansion: "./gradlew", Description: "Gradle wrapper", Framework: "java"},
		{Name: "mvn", Expansion: "mvn", Description: "Maven", Framework: "java"},
		{Name: "maven", Expansion: "mvn", Description: "Maven", Framework: "java"},

		{Name: "dotnet", Expansion: "dotnet", Description: ".NET CLI", Framework: "dotnet"},

		{Name: "mix", Expansion: "mix", Description: "Elixir Mix", Framework: "elixir"},
		{Name: "iex", Expansion: "iex", Description: "Elixir IEx", Framework: "elixir"},

		{Name: "swift", Expansion: "swift", Description: "Swift", Framework: "swift"},
		{Name: "spm", Expansion: "swift package", Description: "Swift Package Manager", Framework: "swift"},

		{Name: "flutter", Expansion: "flutter", Description: "Flutter", Framework: "flutter"},
		{Name: "dart", Expansion: "dart", Description: "Dart", Framework: "dart"},

		{Name: "make", Expansion: "make", Description: "Make", Framework: ""},
		{Name: "cmake", Expansion: "cmake", Description: "CMake", Framework: ""},

		{Name: "js", Expansion: "node", Description: "JavaScript (Node)", Framework: "javascript"},
		{Name: "ts", Expansion: "ts-node", Description: "TypeScript (ts-node)", Framework: "typescript"},
		{Name: "deno", Expansion: "deno", Description: "Deno", Framework: "javascript"},
		{Name: "node", Expansion: "node", Description: "Node.js runtime", Framework: "node"},

		{Name: "java", Expansion: "java", Description: "Java", Framework: "java"},
		{Name: "javac", Expansion: "javac", Description: "Java compiler", Framework: "java"},
		{Name: "mvn", Expansion: "mvn", Description: "Maven", Framework: "java"},
		{Name: "gradle", Expansion: "./gradlew", Description: "Gradle wrapper", Framework: "java"},
		{Name: "kotlin", Expansion: "kotlinc", Description: "Kotlin compiler", Framework: "kotlin"},
		{Name: "kotlinc", Expansion: "kotlinc", Description: "Kotlin compiler", Framework: "kotlin"},

		{Name: "c", Expansion: "gcc", Description: "C (GCC)", Framework: "c"},
		{Name: "cpp", Expansion: "g++", Description: "C++ (G++)", Framework: "cpp"},
		{Name: "cc", Expansion: "clang++", Description: "C++ (Clang)", Framework: "cpp"},
		{Name: "gcc", Expansion: "gcc", Description: "GCC", Framework: "c"},
		{Name: "clang", Expansion: "clang", Description: "Clang", Framework: "c"},

		{Name: "cs", Expansion: "dotnet", Description: "C# (.NET)", Framework: "dotnet"},
		{Name: "csharp", Expansion: "dotnet", Description: "C# (.NET)", Framework: "dotnet"},
		{Name: "dotnet", Expansion: "dotnet", Description: ".NET CLI", Framework: "dotnet"},

		{Name: "ps", Expansion: "pwsh", Description: "PowerShell", Framework: "powershell"},
		{Name: "pwsh", Expansion: "pwsh", Description: "PowerShell", Framework: "powershell"},
		{Name: "powershell", Expansion: "powershell", Description: "PowerShell", Framework: "powershell"},

		{Name: "sh", Expansion: "sh", Description: "Shell", Framework: "shell"},
		{Name: "bash", Expansion: "bash", Description: "Bash", Framework: "shell"},
		{Name: "zsh", Expansion: "zsh", Description: "Zsh", Framework: "shell"},

		{Name: "sql", Expansion: "psql", Description: "SQL (PostgreSQL)", Framework: "sql"},
		{Name: "psql", Expansion: "psql", Description: "PostgreSQL", Framework: "sql"},
		{Name: "mysql", Expansion: "mysql", Description: "MySQL", Framework: "sql"},
		{Name: "sqlite", Expansion: "sqlite3", Description: "SQLite", Framework: "sql"},
		{Name: "sqlite3", Expansion: "sqlite3", Description: "SQLite", Framework: "sql"},

		{Name: "rb", Expansion: "ruby", Description: "Ruby", Framework: "ruby"},
		{Name: "ruby", Expansion: "ruby", Description: "Ruby", Framework: "ruby"},
		{Name: "rails", Expansion: "rails", Description: "Ruby on Rails", Framework: "rails"},

		{Name: "dart", Expansion: "dart", Description: "Dart", Framework: "dart"},
		{Name: "flutter", Expansion: "flutter", Description: "Flutter", Framework: "flutter"},

		{Name: "swift", Expansion: "swift", Description: "Swift", Framework: "swift"},
		{Name: "spm", Expansion: "swift package", Description: "Swift Package Manager", Framework: "swift"},

		{Name: "r", Expansion: "Rscript", Description: "R", Framework: "r"},
		{Name: "rscript", Expansion: "Rscript", Description: "R", Framework: "r"},

		{Name: "groovy", Expansion: "groovy", Description: "Groovy", Framework: "groovy"},
		{Name: "vb", Expansion: "vbnc", Description: "Visual Basic (.NET)", Framework: "vb"},
		{Name: "vba", Expansion: "cscript", Description: "VBA/VBScript", Framework: "vba"},
		{Name: "matlab", Expansion: "matlab", Description: "MATLAB", Framework: "matlab"},
		{Name: "perl", Expansion: "perl", Description: "Perl", Framework: "perl"},
		{Name: "gd", Expansion: "godot", Description: "GDScript (Godot)", Framework: "gdscript"},

		{Name: "elixir", Expansion: "mix", Description: "Elixir (Mix)", Framework: "elixir"},
		{Name: "scala", Expansion: "sbt", Description: "Scala (sbt)", Framework: "scala"},
		{Name: "sbt", Expansion: "sbt", Description: "Scala build", Framework: "scala"},
		{Name: "delphi", Expansion: "dcc32", Description: "Delphi", Framework: "delphi"},
		{Name: "lisp", Expansion: "sbcl", Description: "Lisp (SBCL)", Framework: "lisp"},
		{Name: "zig", Expansion: "zig", Description: "Zig", Framework: "zig"},
		{Name: "erlang", Expansion: "erl", Description: "Erlang", Framework: "erlang"},
		{Name: "rebar3", Expansion: "rebar3", Description: "Erlang (rebar3)", Framework: "erlang"},
		{Name: "fortran", Expansion: "gfortran", Description: "Fortran", Framework: "fortran"},
		{Name: "ada", Expansion: "gnatmake", Description: "Ada", Framework: "ada"},
		{Name: "fsharp", Expansion: "dotnet fsi", Description: "F#", Framework: "fsharp"},
		{Name: "ocaml", Expansion: "ocaml", Description: "OCaml", Framework: "ocaml"},
		{Name: "dune", Expansion: "dune", Description: "OCaml (Dune)", Framework: "ocaml"},
		{Name: "gleam", Expansion: "gleam", Description: "Gleam", Framework: "gleam"},
		{Name: "prolog", Expansion: "swipl", Description: "Prolog", Framework: "prolog"},
		{Name: "cobol", Expansion: "cobc", Description: "COBOL", Framework: "cobol"},
		{Name: "haskell", Expansion: "ghc", Description: "Haskell", Framework: "haskell"},
		{Name: "stack", Expansion: "stack", Description: "Haskell (Stack)", Framework: "haskell"},
		{Name: "cabal", Expansion: "cabal", Description: "Haskell (Cabal)", Framework: "haskell"},
		{Name: "julia", Expansion: "julia", Description: "Julia", Framework: "julia"},
		{Name: "clj", Expansion: "clj", Description: "Clojure", Framework: "clojure"},
		{Name: "clojure", Expansion: "clj", Description: "Clojure", Framework: "clojure"},
		{Name: "objc", Expansion: "clang", Description: "Objective-C", Framework: "objective-c"},
		{Name: "asm", Expansion: "nasm", Description: "Assembly", Framework: "assembly"},

		{Name: "json", Expansion: "jq", Description: "JSON", Framework: "data"},
		{Name: "yaml", Expansion: "yq", Description: "YAML", Framework: "data"},
		{Name: "xml", Expansion: "xmlstarlet", Description: "XML", Framework: "data"},
		{Name: "toml", Expansion: "tomlq", Description: "TOML", Framework: "data"},
		{Name: "ini", Expansion: "crudini", Description: "INI", Framework: "data"},
		{Name: "md", Expansion: "mdcat", Description: "Markdown", Framework: "data"},

		{Name: "laravel", Expansion: "php artisan", Description: "Laravel Artisan", Framework: "laravel"},
		{Name: "symfony", Expansion: "symfony console", Description: "Symfony Console", Framework: "symfony"},
		{Name: "django", Expansion: "python manage.py", Description: "Django manage.py", Framework: "django"},
		{Name: "flask", Expansion: "flask", Description: "Flask", Framework: "flask"},
		{Name: "fastapi", Expansion: "uvicorn", Description: "FastAPI (uvicorn)", Framework: "fastapi"},
		{Name: "react", Expansion: "npx", Description: "React", Framework: "react"},
		{Name: "next", Expansion: "npx", Description: "Next.js", Framework: "next"},
		{Name: "nuxt", Expansion: "npx", Description: "Nuxt", Framework: "nuxt"},
		{Name: "vue", Expansion: "npx", Description: "Vue", Framework: "vue"},
		{Name: "svelte", Expansion: "npx", Description: "Svelte", Framework: "svelte"},
		{Name: "angular", Expansion: "ng", Description: "Angular", Framework: "angular"},
		{Name: "nest", Expansion: "nest", Description: "NestJS", Framework: "nest"},
		{Name: "spring", Expansion: "mvn", Description: "Spring Boot", Framework: "spring"},
	}

	for _, tag := range defaults {
		t := tag
		r.tags[t.Name] = &t
	}
}

func (r *TagRegistry) Register(tag *TagDefinition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tags[tag.Name] = tag
}

func (r *TagRegistry) Get(name string) *TagDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tags[name]
}

func (r *TagRegistry) All() []*TagDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]*TagDefinition, 0, len(r.tags))
	for _, tag := range r.tags {
		result = append(result, tag)
	}
	return result
}

func (r *TagRegistry) ByFramework(framework string) []*TagDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []*TagDefinition
	for _, tag := range r.tags {
		if tag.Framework == framework {
			result = append(result, tag)
		}
	}
	return result
}

func (r *TagRegistry) Match(prefix string) []*TagDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var matches []*TagDefinition
	for name, tag := range r.tags {
		if len(prefix) <= len(name) && name[:len(prefix)] == prefix {
			matches = append(matches, tag)
		}
	}
	return matches
}

func (r *TagRegistry) Expand(input string) string {
	if len(input) == 0 || input[0] != '@' {
		return input
	}

	rest := input[1:]
	spaceIdx := -1
	for i, c := range rest {
		if c == ' ' {
			spaceIdx = i
			break
		}
	}

	var tagName, args string
	if spaceIdx == -1 {
		tagName = rest
	} else {
		tagName = rest[:spaceIdx]
		args = rest[spaceIdx+1:]
	}

	r.mu.RLock()
	tag := r.tags[tagName]
	r.mu.RUnlock()

	if tag == nil {
		return input
	}

	if args == "" {
		return tag.Expansion
	}
	return tag.Expansion + " " + args
}
