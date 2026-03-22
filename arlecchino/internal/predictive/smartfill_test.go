package predictive

import "testing"

func TestPlaceholderResolver_ResolvePlaceholders(t *testing.T) {
	resolver := NewPlaceholderResolver()

	tests := []struct {
		name     string
		template string
		ctx      *FileContext
		want     string
	}{
		{
			name:     "controller from class name",
			template: "Route::resource('users', $CONTROLLER::class);",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UserController.php",
				ClassName: "UserController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "Route::resource('users', UserController::class);",
		},
		{
			name:     "model from controller name",
			template: "$$users = $MODEL::all();",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/UsersController.php",
				ClassName: "UsersController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "$$users = User::all();",
		},
		{
			name:     "path from model",
			template: "Route::get('/$PATH', [$CONTROLLER::class, 'index']);",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/ProductController.php",
				ClassName: "ProductController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "Route::get('/products', [ProductController::class, 'index']);",
		},
		{
			name:     "multiple placeholders",
			template: "public function show($MODEL $$model): JsonResponse\n{\n\treturn response()->json($$model);\n}",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/OrderController.php",
				ClassName: "OrderController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "public function show(Order $$model): JsonResponse\n{\n\treturn response()->json($$model);\n}",
		},
		{
			name:     "request from model",
			template: "public function store($REQUEST $$request)",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/ArticleController.php",
				ClassName: "ArticleController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "public function store(ArticleRequest $$request)",
		},
		{
			name:     "table from migration filename",
			template: "Schema::create('$TABLE', function (Blueprint $$table) {",
			ctx: &FileContext{
				FilePath:  "/database/migrations/2024_01_01_000000_create_posts_table.php",
				Language:  "php",
				Framework: "laravel",
			},
			want: "Schema::create('posts', function (Blueprint $$table) {",
		},
		{
			name:     "infers from route filename",
			template: "Route::get('/$PATH', [$CONTROLLER::class, '$METHOD']);",
			ctx: &FileContext{
				FilePath: "/routes/web.php",
				Language: "php",
			},
			want: "Route::get('/webs', [WebController::class, 'index']);",
		},
		{
			name:     "nil context returns original",
			template: "Route::get('/$PATH', [$CONTROLLER::class, '$METHOD']);",
			ctx:      nil,
			want:     "Route::get('/$PATH', [$CONTROLLER::class, '$METHOD']);",
		},
		{
			name:     "preserves tabstop placeholders",
			template: "protected $$fillable = [\n\t$1\n];",
			ctx: &FileContext{
				FilePath:  "/app/Models/User.php",
				ClassName: "User",
				Language:  "php",
			},
			want: "protected $$fillable = [\n\t$1\n];",
		},
		{
			name:     "view placeholder",
			template: "return view('$VIEW', ['$VAR' => $$data]);",
			ctx: &FileContext{
				FilePath:  "/app/Http/Controllers/PostController.php",
				ClassName: "PostController",
				Language:  "php",
				Framework: "laravel",
			},
			want: "return view('posts.index', ['posts' => $$data]);",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolver.ResolvePlaceholders(tt.template, tt.ctx)
			if got != tt.want {
				t.Errorf("ResolvePlaceholders() =\n%q\nwant\n%q", got, tt.want)
			}
		})
	}
}

func TestSingularize(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Users", "User"},
		{"Categories", "Category"},
		{"Boxes", "Box"},
		{"Matches", "Match"},
		{"Posts", "Post"},
		{"Class", "Class"},
		{"Status", "Statu"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := singularize(tt.input)
			if got != tt.want {
				t.Errorf("singularize(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestPluralize(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"User", "Users"},
		{"Category", "Categories"},
		{"Box", "Boxes"},
		{"Match", "Matches"},
		{"Post", "Posts"},
		{"Class", "Classes"},
		{"Day", "Days"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := pluralize(tt.input)
			if got != tt.want {
				t.Errorf("pluralize(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestExtractTableFromMigration(t *testing.T) {
	tests := []struct {
		fileName string
		want     string
	}{
		{"2024_01_01_000000_create_users_table.php", "users"},
		{"2024_01_01_000001_create_order_items_table.php", "order_items"},
		{"2024_01_01_000002_create_categories_table.php", "categories"},
		{"some_random_file.php", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fileName, func(t *testing.T) {
			got := extractTableFromMigration(tt.fileName)
			if got != tt.want {
				t.Errorf("extractTableFromMigration(%q) = %q, want %q", tt.fileName, got, tt.want)
			}
		})
	}
}

func TestResolveOne(t *testing.T) {
	resolver := NewPlaceholderResolver()

	ctx := &FileContext{
		FilePath:  "/app/Http/Controllers/UserController.php",
		ClassName: "UserController",
		Language:  "php",
		Framework: "laravel",
	}

	tests := []struct {
		placeholder string
		want        string
	}{
		{"CONTROLLER", "UserController"},
		{"MODEL", "User"},
		{"PATH", "users"},
		{"RESOURCE", "users"},
		{"REQUEST", "UserRequest"},
		{"NAME", "UserController"},
		{"TYPE", "string"},
		{"UNKNOWN_PLACEHOLDER", "$UNKNOWN_PLACEHOLDER"},
	}

	for _, tt := range tests {
		t.Run(tt.placeholder, func(t *testing.T) {
			got := resolver.ResolveOne(tt.placeholder, ctx)
			if got != tt.want {
				t.Errorf("ResolveOne(%q) = %q, want %q", tt.placeholder, got, tt.want)
			}
		})
	}
}
