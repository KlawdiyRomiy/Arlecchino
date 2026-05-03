package predictive

import "strings"

var htmlTagKeywords = []KeywordInfo{
	{Name: "div", Kind: "keyword", InsertText: "div", Priority: 80},
	{Name: "span", Kind: "keyword", InsertText: "span", Priority: 75},
	{Name: "p", Kind: "keyword", InsertText: "p", Priority: 75},
	{Name: "a", Kind: "keyword", InsertText: "a", Priority: 75},
	{Name: "ul", Kind: "keyword", InsertText: "ul", Priority: 75},
	{Name: "ol", Kind: "keyword", InsertText: "ol", Priority: 70},
	{Name: "li", Kind: "keyword", InsertText: "li", Priority: 70},
	{Name: "button", Kind: "keyword", InsertText: "button", Priority: 75},
	{Name: "input", Kind: "keyword", InsertText: "input", Priority: 75},
	{Name: "form", Kind: "keyword", InsertText: "form", Priority: 70},
	{Name: "label", Kind: "keyword", InsertText: "label", Priority: 70},
	{Name: "img", Kind: "keyword", InsertText: "img", Priority: 70},
	{Name: "section", Kind: "keyword", InsertText: "section", Priority: 70},
	{Name: "header", Kind: "keyword", InsertText: "header", Priority: 70},
	{Name: "footer", Kind: "keyword", InsertText: "footer", Priority: 70},
	{Name: "main", Kind: "keyword", InsertText: "main", Priority: 70},
	{Name: "nav", Kind: "keyword", InsertText: "nav", Priority: 70},
	{Name: "article", Kind: "keyword", InsertText: "article", Priority: 70},
	{Name: "aside", Kind: "keyword", InsertText: "aside", Priority: 70},
	{Name: "h1", Kind: "keyword", InsertText: "h1", Priority: 70},
	{Name: "h2", Kind: "keyword", InsertText: "h2", Priority: 70},
	{Name: "h3", Kind: "keyword", InsertText: "h3", Priority: 70},
	{Name: "table", Kind: "keyword", InsertText: "table", Priority: 70},
	{Name: "thead", Kind: "keyword", InsertText: "thead", Priority: 65},
	{Name: "tbody", Kind: "keyword", InsertText: "tbody", Priority: 65},
	{Name: "tr", Kind: "keyword", InsertText: "tr", Priority: 65},
	{Name: "td", Kind: "keyword", InsertText: "td", Priority: 65},
	{Name: "th", Kind: "keyword", InsertText: "th", Priority: 65},
}

var astroGlobalKeywords = []KeywordInfo{
	{Name: "url", Kind: "property", InsertText: "url", Priority: 80},
	{Name: "params", Kind: "property", InsertText: "params", Priority: 80},
	{Name: "props", Kind: "property", InsertText: "props", Priority: 80},
	{Name: "request", Kind: "property", InsertText: "request", Priority: 75},
	{Name: "cookies", Kind: "property", InsertText: "cookies", Priority: 75},
	{Name: "redirect", Kind: "function", InsertText: "redirect", Priority: 75},
	{Name: "site", Kind: "property", InsertText: "site", Priority: 70},
	{Name: "slots", Kind: "property", InsertText: "slots", Priority: 70},
	{Name: "clientAddress", Kind: "property", InsertText: "clientAddress", Priority: 70},
	{Name: "generator", Kind: "property", InsertText: "generator", Priority: 70},
}

var cssValueKeywords = []KeywordInfo{
	{Name: "auto", Kind: "constant", InsertText: "auto", Priority: 75},
	{Name: "none", Kind: "constant", InsertText: "none", Priority: 75},
	{Name: "inherit", Kind: "constant", InsertText: "inherit", Priority: 70},
	{Name: "initial", Kind: "constant", InsertText: "initial", Priority: 70},
	{Name: "unset", Kind: "constant", InsertText: "unset", Priority: 70},
	{Name: "var(--", Kind: "function", InsertText: "var(--", Priority: 75},
	{Name: "calc(", Kind: "function", InsertText: "calc(", Priority: 75},
	{Name: "rgb(", Kind: "function", InsertText: "rgb(", Priority: 70},
	{Name: "rgba(", Kind: "function", InsertText: "rgba(", Priority: 70},
	{Name: "hsl(", Kind: "function", InsertText: "hsl(", Priority: 70},
	{Name: "hsla(", Kind: "function", InsertText: "hsla(", Priority: 70},
	{Name: "scale()", Kind: "function", InsertText: "scale()", Priority: 70},
	{Name: "scaleX()", Kind: "function", InsertText: "scaleX()", Priority: 70},
	{Name: "scaleY()", Kind: "function", InsertText: "scaleY()", Priority: 70},
	{Name: "rotate()", Kind: "function", InsertText: "rotate()", Priority: 70},
	{Name: "translate()", Kind: "function", InsertText: "translate()", Priority: 70},
	{Name: "translateX()", Kind: "function", InsertText: "translateX()", Priority: 70},
	{Name: "translateY()", Kind: "function", InsertText: "translateY()", Priority: 70},
	{Name: "skew()", Kind: "function", InsertText: "skew()", Priority: 70},
}

var bashDollarKeywords = []KeywordInfo{
	{Name: "$VAR", Kind: "variable", InsertText: "", Priority: 80},
	{Name: "${VAR}", Kind: "variable", InsertText: "", Priority: 75},
}

var LanguageKeywords = map[string][]KeywordInfo{
	"python": {
		{Name: "print", Kind: "function", InsertText: "print($1)", Priority: 95},
		{Name: "def", Kind: "keyword", InsertText: "def ${1:name}($2):\n\t$0", Priority: 90},
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name}:\n\t$0", Priority: 90},
		{Name: "import", Kind: "keyword", InsertText: "import $1", Priority: 88},
		{Name: "from", Kind: "keyword", InsertText: "from $1 import $2", Priority: 88},
		{Name: "if", Kind: "keyword", InsertText: "if $1:\n\t$0", Priority: 85},
		{Name: "elif", Kind: "keyword", InsertText: "elif $1:\n\t$0", Priority: 85},
		{Name: "else", Kind: "keyword", InsertText: "else:\n\t$0", Priority: 85},
		{Name: "for", Kind: "keyword", InsertText: "for ${1:item} in ${2:items}:\n\t$0", Priority: 85},
		{Name: "while", Kind: "keyword", InsertText: "while $1:\n\t$0", Priority: 85},
		{Name: "try", Kind: "keyword", InsertText: "try:\n\t$1\nexcept $2:\n\t$0", Priority: 80},
		{Name: "except", Kind: "keyword", InsertText: "except $1:\n\t$0", Priority: 80},
		{Name: "finally", Kind: "keyword", InsertText: "finally:\n\t$0", Priority: 80},
		{Name: "with", Kind: "keyword", InsertText: "with $1 as $2:\n\t$0", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1", Priority: 85},
		{Name: "yield", Kind: "keyword", InsertText: "yield $1", Priority: 75},
		{Name: "lambda", Kind: "keyword", InsertText: "lambda $1: $0", Priority: 75},
		{Name: "async", Kind: "keyword", InsertText: "async def ${1:name}($2):\n\t$0", Priority: 80},
		{Name: "await", Kind: "keyword", InsertText: "await $1", Priority: 80},
		{Name: "pass", Kind: "keyword", InsertText: "pass", Priority: 70},
		{Name: "break", Kind: "keyword", InsertText: "break", Priority: 70},
		{Name: "continue", Kind: "keyword", InsertText: "continue", Priority: 70},
		{Name: "True", Kind: "constant", InsertText: "True", Priority: 75},
		{Name: "False", Kind: "constant", InsertText: "False", Priority: 75},
		{Name: "None", Kind: "constant", InsertText: "None", Priority: 75},
		{Name: "self", Kind: "variable", InsertText: "self", Priority: 90},
		{Name: "len", Kind: "function", InsertText: "len($1)", Priority: 85},
		{Name: "range", Kind: "function", InsertText: "range($1)", Priority: 85},
		{Name: "str", Kind: "function", InsertText: "str($1)", Priority: 80},
		{Name: "int", Kind: "function", InsertText: "int($1)", Priority: 80},
		{Name: "list", Kind: "function", InsertText: "list($1)", Priority: 80},
		{Name: "dict", Kind: "function", InsertText: "dict($1)", Priority: 80},
		{Name: "open", Kind: "function", InsertText: "open($1)", Priority: 80},
		{Name: "input", Kind: "function", InsertText: "input($1)", Priority: 80},
		{Name: "type", Kind: "function", InsertText: "type($1)", Priority: 75},
		{Name: "isinstance", Kind: "function", InsertText: "isinstance($1, $2)", Priority: 75},
		{Name: "enumerate", Kind: "function", InsertText: "enumerate($1)", Priority: 80},
		{Name: "zip", Kind: "function", InsertText: "zip($1, $2)", Priority: 75},
		{Name: "map", Kind: "function", InsertText: "map($1, $2)", Priority: 75},
		{Name: "filter", Kind: "function", InsertText: "filter($1, $2)", Priority: 75},
	},
	"go": {
		{Name: "func", Kind: "keyword", InsertText: "func ${1:name}($2) $3 {\n\t$0\n}", Priority: 95},
		{Name: "package", Kind: "keyword", InsertText: "package $1", Priority: 95},
		{Name: "main", Kind: "package", InsertText: "main", Priority: 85},
		{Name: "import", Kind: "keyword", InsertText: "import \"$1\"", Priority: 90},
		{Name: "type", Kind: "keyword", InsertText: "type ${1:Name} struct {\n$0\n}", Priority: 90},
		{Name: "struct", Kind: "keyword", InsertText: "struct {\n$0\n}", Priority: 85},
		{Name: "interface", Kind: "keyword", InsertText: "interface {\n$0\n}", Priority: 85},
		{Name: "var", Kind: "keyword", InsertText: "var $1 $2", Priority: 85},
		{Name: "const", Kind: "keyword", InsertText: "const $1 = $2", Priority: 85},
		{Name: "if", Kind: "keyword", InsertText: "if $1 {\n\t$0\n}", Priority: 85},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 85},
		{Name: "for", Kind: "keyword", InsertText: "for $1 {\n\t$0\n}", Priority: 85},
		{Name: "range", Kind: "keyword", InsertText: "range $1", Priority: 80},
		{Name: "switch", Kind: "keyword", InsertText: "switch $1 {\ncase $2:\n\t$0\n}", Priority: 80},
		{Name: "case", Kind: "keyword", InsertText: "case $1:\n\t$0", Priority: 80},
		{Name: "default", Kind: "keyword", InsertText: "default:\n\t$0", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1", Priority: 85},
		{Name: "defer", Kind: "keyword", InsertText: "defer $1", Priority: 80},
		{Name: "go", Kind: "keyword", InsertText: "go $1", Priority: 80},
		{Name: "chan", Kind: "keyword", InsertText: "chan $1", Priority: 75},
		{Name: "select", Kind: "keyword", InsertText: "select {\ncase $1:\n\t$0\n}", Priority: 75},
		{Name: "make", Kind: "function", InsertText: "make($1)", Priority: 85},
		{Name: "new", Kind: "function", InsertText: "new($1)", Priority: 80},
		{Name: "len", Kind: "function", InsertText: "len($1)", Priority: 85},
		{Name: "cap", Kind: "function", InsertText: "cap($1)", Priority: 80},
		{Name: "append", Kind: "function", InsertText: "append($1, $2)", Priority: 85},
		{Name: "copy", Kind: "function", InsertText: "copy($1, $2)", Priority: 80},
		{Name: "delete", Kind: "function", InsertText: "delete($1, $2)", Priority: 80},
		{Name: "panic", Kind: "function", InsertText: "panic($1)", Priority: 75},
		{Name: "recover", Kind: "function", InsertText: "recover()", Priority: 75},
		{Name: "close", Kind: "function", InsertText: "close($1)", Priority: 75},
		{Name: "fmt.Println", Kind: "function", InsertText: "fmt.Println($1)", Priority: 90},
		{Name: "fmt.Printf", Kind: "function", InsertText: "fmt.Printf(\"$1\", $2)", Priority: 88},
		{Name: "fmt.Sprintf", Kind: "function", InsertText: "fmt.Sprintf(\"$1\", $2)", Priority: 85},
		{Name: "err", Kind: "variable", InsertText: "err", Priority: 90},
		{Name: "nil", Kind: "constant", InsertText: "nil", Priority: 85},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 80},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 80},
		{Name: "iota", Kind: "constant", InsertText: "iota", Priority: 75},
	},
	"php": {
		{Name: "function", Kind: "keyword", InsertText: "function ${1:name}($2)\n{\n\t$0\n}", Priority: 95},
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name}\n{\n\t$0\n}", Priority: 95},
		{Name: "public", Kind: "keyword", InsertText: "public function ${1:name}($2)\n{\n\t$0\n}", Priority: 90},
		{Name: "private", Kind: "keyword", InsertText: "private function ${1:name}($2)\n{\n\t$0\n}", Priority: 85},
		{Name: "protected", Kind: "keyword", InsertText: "protected function ${1:name}($2)\n{\n\t$0\n}", Priority: 85},
		{Name: "static", Kind: "keyword", InsertText: "static", Priority: 80},
		{Name: "abstract", Kind: "keyword", InsertText: "abstract", Priority: 75},
		{Name: "interface", Kind: "keyword", InsertText: "interface ${1:Name}\n{\n\t$0\n}", Priority: 85},
		{Name: "trait", Kind: "keyword", InsertText: "trait ${1:Name}\n{\n\t$0\n}", Priority: 80},
		{Name: "namespace", Kind: "keyword", InsertText: "namespace $1;", Priority: 90},
		{Name: "use", Kind: "keyword", InsertText: "use $1;", Priority: 88},
		{Name: "extends", Kind: "keyword", InsertText: "extends $1", Priority: 85},
		{Name: "implements", Kind: "keyword", InsertText: "implements $1", Priority: 85},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 85},
		{Name: "elseif", Kind: "keyword", InsertText: "elseif ($1) {\n\t$0\n}", Priority: 85},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 85},
		{Name: "foreach", Kind: "keyword", InsertText: "foreach ($1 as $2) {\n\t$0\n}", Priority: 85},
		{Name: "for", Kind: "keyword", InsertText: "for ($1; $2; $3) {\n\t$0\n}", Priority: 85},
		{Name: "while", Kind: "keyword", InsertText: "while ($1) {\n\t$0\n}", Priority: 85},
		{Name: "switch", Kind: "keyword", InsertText: "switch ($1) {\n\tcase $2:\n\t\t$0\n\t\tbreak;\n}", Priority: 80},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch ($2) {\n\t$0\n}", Priority: 80},
		{Name: "catch", Kind: "keyword", InsertText: "catch ($1) {\n\t$0\n}", Priority: 80},
		{Name: "finally", Kind: "keyword", InsertText: "finally {\n\t$0\n}", Priority: 80},
		{Name: "throw", Kind: "keyword", InsertText: "throw new $1($2);", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1;", Priority: 85},
		{Name: "echo", Kind: "keyword", InsertText: "echo $1;", Priority: 85},
		{Name: "print", Kind: "keyword", InsertText: "print $1;", Priority: 80},
		{Name: "new", Kind: "keyword", InsertText: "new $1($2)", Priority: 85},
		{Name: "$this", Kind: "variable", InsertText: "$this->$1", Priority: 95},
		{Name: "self", Kind: "keyword", InsertText: "self::$1", Priority: 90},
		{Name: "parent", Kind: "keyword", InsertText: "parent::$1", Priority: 85},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 80},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 80},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 80},
		{Name: "array", Kind: "function", InsertText: "array($1)", Priority: 80},
		{Name: "isset", Kind: "function", InsertText: "isset($1)", Priority: 80},
		{Name: "empty", Kind: "function", InsertText: "empty($1)", Priority: 80},
		{Name: "count", Kind: "function", InsertText: "count($1)", Priority: 80},
		{Name: "strlen", Kind: "function", InsertText: "strlen($1)", Priority: 75},
		{Name: "var_dump", Kind: "function", InsertText: "var_dump($1);", Priority: 85},
		{Name: "print_r", Kind: "function", InsertText: "print_r($1);", Priority: 80},
	},
	"blade": {
		{Name: "@if", Kind: "keyword", InsertText: "@if", Priority: 85},
		{Name: "@elseif", Kind: "keyword", InsertText: "@elseif", Priority: 80},
		{Name: "@else", Kind: "keyword", InsertText: "@else", Priority: 80},
		{Name: "@endif", Kind: "keyword", InsertText: "@endif", Priority: 80},
		{Name: "@foreach", Kind: "keyword", InsertText: "@foreach", Priority: 85},
		{Name: "@forelse", Kind: "keyword", InsertText: "@forelse", Priority: 80},
		{Name: "@endforeach", Kind: "keyword", InsertText: "@endforeach", Priority: 80},
		{Name: "@endforelse", Kind: "keyword", InsertText: "@endforelse", Priority: 80},
		{Name: "@section", Kind: "keyword", InsertText: "@section('')", Priority: 85},
		{Name: "@endsection", Kind: "keyword", InsertText: "@endsection", Priority: 80},
		{Name: "@yield", Kind: "keyword", InsertText: "@yield('')", Priority: 85},
		{Name: "@extends", Kind: "keyword", InsertText: "@extends('')", Priority: 85},
		{Name: "@include", Kind: "keyword", InsertText: "@include('')", Priority: 85},
		{Name: "@component", Kind: "keyword", InsertText: "@component('')", Priority: 80},
		{Name: "@stack", Kind: "keyword", InsertText: "@stack('')", Priority: 75},
		{Name: "@push", Kind: "keyword", InsertText: "@push('')", Priority: 75},
		{Name: "@endpush", Kind: "keyword", InsertText: "@endpush", Priority: 70},
		{Name: "@auth", Kind: "keyword", InsertText: "@auth", Priority: 75},
		{Name: "@guest", Kind: "keyword", InsertText: "@guest", Priority: 75},
		{Name: "@csrf", Kind: "keyword", InsertText: "@csrf", Priority: 70},
		{Name: "@method", Kind: "keyword", InsertText: "@method('')", Priority: 70},
		{Name: "@php", Kind: "keyword", InsertText: "@php", Priority: 70},
		{Name: "@endphp", Kind: "keyword", InsertText: "@endphp", Priority: 70},
		{Name: "@session", Kind: "keyword", InsertText: "@session", Priority: 70},
	},
	"astro": {
		{Name: "Astro", Kind: "variable", InsertText: "Astro", Priority: 90},
		{Name: "class:list", Kind: "property", InsertText: "class:list", Priority: 80},
		{Name: "set:html", Kind: "property", InsertText: "set:html", Priority: 80},
		{Name: "set:text", Kind: "property", InsertText: "set:text", Priority: 80},
		{Name: "client:load", Kind: "property", InsertText: "client:load", Priority: 75},
		{Name: "client:idle", Kind: "property", InsertText: "client:idle", Priority: 75},
		{Name: "client:visible", Kind: "property", InsertText: "client:visible", Priority: 75},
		{Name: "client:media", Kind: "property", InsertText: "client:media", Priority: 75},
		{Name: "client:only", Kind: "property", InsertText: "client:only", Priority: 75},
	},
	"typescript": {
		{Name: "function", Kind: "keyword", InsertText: "function ${1:name}($2): $3 {\n\t$0\n}", Priority: 90},
		{Name: "const", Kind: "keyword", InsertText: "const $1 = $2;", Priority: 95},
		{Name: "let", Kind: "keyword", InsertText: "let $1 = $2;", Priority: 90},
		{Name: "var", Kind: "keyword", InsertText: "var $1 = $2;", Priority: 75},
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name} {\n\t$0\n}", Priority: 90},
		{Name: "interface", Kind: "keyword", InsertText: "interface ${1:Name} {\n\t$0\n}", Priority: 90},
		{Name: "type", Kind: "keyword", InsertText: "type ${1:Name} = $2;", Priority: 88},
		{Name: "enum", Kind: "keyword", InsertText: "enum ${1:Name} {\n\t$0\n}", Priority: 85},
		{Name: "import", Kind: "keyword", InsertText: "import { $1 } from '$2';", Priority: 95},
		{Name: "export", Kind: "keyword", InsertText: "export $1", Priority: 90},
		{Name: "async", Kind: "keyword", InsertText: "async function ${1:name}($2): Promise<$3> {\n\t$0\n}", Priority: 88},
		{Name: "await", Kind: "keyword", InsertText: "await $1", Priority: 85},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 85},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 85},
		{Name: "for", Kind: "keyword", InsertText: "for (let ${1:i} = 0; $1 < $2; $1++) {\n\t$0\n}", Priority: 85},
		{Name: "forEach", Kind: "method", InsertText: "forEach(($1) => {\n\t$0\n})", Priority: 85},
		{Name: "map", Kind: "method", InsertText: "map(($1) => $2)", Priority: 85},
		{Name: "filter", Kind: "method", InsertText: "filter(($1) => $2)", Priority: 85},
		{Name: "reduce", Kind: "method", InsertText: "reduce(($1, $2) => $3, $4)", Priority: 80},
		{Name: "while", Kind: "keyword", InsertText: "while ($1) {\n\t$0\n}", Priority: 80},
		{Name: "switch", Kind: "keyword", InsertText: "switch ($1) {\n\tcase $2:\n\t\t$0\n\t\tbreak;\n}", Priority: 80},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch (error) {\n\t$0\n}", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1;", Priority: 85},
		{Name: "throw", Kind: "keyword", InsertText: "throw new Error($1);", Priority: 80},
		{Name: "console.log", Kind: "function", InsertText: "console.log($1);", Priority: 95},
		{Name: "console.error", Kind: "function", InsertText: "console.error($1);", Priority: 85},
		{Name: "console.warn", Kind: "function", InsertText: "console.warn($1);", Priority: 80},
		{Name: "Promise", Kind: "class", InsertText: "Promise<$1>", Priority: 85},
		{Name: "Array", Kind: "class", InsertText: "Array<$1>", Priority: 80},
		{Name: "string", Kind: "type", InsertText: "string", Priority: 85},
		{Name: "number", Kind: "type", InsertText: "number", Priority: 85},
		{Name: "boolean", Kind: "type", InsertText: "boolean", Priority: 85},
		{Name: "void", Kind: "type", InsertText: "void", Priority: 80},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 80},
		{Name: "undefined", Kind: "constant", InsertText: "undefined", Priority: 80},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 80},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 80},
	},
	"javascript": {
		{Name: "function", Kind: "keyword", InsertText: "function ${1:name}($2) {\n\t$0\n}", Priority: 90},
		{Name: "const", Kind: "keyword", InsertText: "const $1 = $2;", Priority: 95},
		{Name: "let", Kind: "keyword", InsertText: "let $1 = $2;", Priority: 90},
		{Name: "var", Kind: "keyword", InsertText: "var $1 = $2;", Priority: 75},
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name} {\n\t$0\n}", Priority: 90},
		{Name: "import", Kind: "keyword", InsertText: "import { $1 } from '$2';", Priority: 95},
		{Name: "export", Kind: "keyword", InsertText: "export $1", Priority: 90},
		{Name: "async", Kind: "keyword", InsertText: "async function ${1:name}($2) {\n\t$0\n}", Priority: 88},
		{Name: "await", Kind: "keyword", InsertText: "await $1", Priority: 85},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 85},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 85},
		{Name: "for", Kind: "keyword", InsertText: "for (let ${1:i} = 0; $1 < $2; $1++) {\n\t$0\n}", Priority: 85},
		{Name: "forEach", Kind: "method", InsertText: "forEach(($1) => {\n\t$0\n})", Priority: 85},
		{Name: "map", Kind: "method", InsertText: "map(($1) => $2)", Priority: 85},
		{Name: "filter", Kind: "method", InsertText: "filter(($1) => $2)", Priority: 85},
		{Name: "while", Kind: "keyword", InsertText: "while ($1) {\n\t$0\n}", Priority: 80},
		{Name: "switch", Kind: "keyword", InsertText: "switch ($1) {\n\tcase $2:\n\t\t$0\n\t\tbreak;\n}", Priority: 80},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch (error) {\n\t$0\n}", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1;", Priority: 85},
		{Name: "throw", Kind: "keyword", InsertText: "throw new Error($1);", Priority: 80},
		{Name: "console.log", Kind: "function", InsertText: "console.log($1);", Priority: 95},
		{Name: "console.error", Kind: "function", InsertText: "console.error($1);", Priority: 85},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 80},
		{Name: "undefined", Kind: "constant", InsertText: "undefined", Priority: 80},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 80},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 80},
	},
	"java": {
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name} {\n\t$0\n}", Priority: 90},
		{Name: "interface", Kind: "keyword", InsertText: "interface ${1:Name} {\n\t$0\n}", Priority: 85},
		{Name: "public", Kind: "keyword", InsertText: "public ", Priority: 80},
		{Name: "private", Kind: "keyword", InsertText: "private ", Priority: 75},
		{Name: "protected", Kind: "keyword", InsertText: "protected ", Priority: 75},
		{Name: "static", Kind: "keyword", InsertText: "static ", Priority: 75},
		{Name: "void", Kind: "keyword", InsertText: "void ", Priority: 70},
		{Name: "import", Kind: "keyword", InsertText: "import $1;", Priority: 85},
		{Name: "package", Kind: "keyword", InsertText: "package $1;", Priority: 85},
		{Name: "extends", Kind: "keyword", InsertText: "extends $1", Priority: 75},
		{Name: "implements", Kind: "keyword", InsertText: "implements $1", Priority: 75},
		{Name: "new", Kind: "keyword", InsertText: "new $1()", Priority: 80},
		{Name: "return", Kind: "keyword", InsertText: "return $1;", Priority: 80},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 80},
		{Name: "for", Kind: "keyword", InsertText: "for ($1; $2; $3) {\n\t$0\n}", Priority: 75},
		{Name: "while", Kind: "keyword", InsertText: "while ($1) {\n\t$0\n}", Priority: 75},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch ($2) {\n\t$0\n}", Priority: 70},
		{Name: "catch", Kind: "keyword", InsertText: "catch ($1) {\n\t$0\n}", Priority: 70},
		{Name: "finally", Kind: "keyword", InsertText: "finally {\n\t$0\n}", Priority: 70},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 70},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
		{Name: "System.out.println", Kind: "function", InsertText: "System.out.println($1);", Priority: 85},
	},
	"csharp": {
		{Name: "using", Kind: "keyword", InsertText: "using ", Priority: 90},
		{Name: "namespace", Kind: "keyword", InsertText: "namespace ", Priority: 85},
		{Name: "class", Kind: "keyword", InsertText: "class ", Priority: 85},
		{Name: "interface", Kind: "keyword", InsertText: "interface ", Priority: 80},
		{Name: "struct", Kind: "keyword", InsertText: "struct ", Priority: 80},
		{Name: "enum", Kind: "keyword", InsertText: "enum ", Priority: 75},
		{Name: "public", Kind: "keyword", InsertText: "public ", Priority: 80},
		{Name: "private", Kind: "keyword", InsertText: "private ", Priority: 75},
		{Name: "protected", Kind: "keyword", InsertText: "protected ", Priority: 75},
		{Name: "internal", Kind: "keyword", InsertText: "internal ", Priority: 70},
		{Name: "static", Kind: "keyword", InsertText: "static ", Priority: 70},
		{Name: "void", Kind: "type", InsertText: "void", Priority: 70},
		{Name: "int", Kind: "type", InsertText: "int", Priority: 70},
		{Name: "string", Kind: "type", InsertText: "string", Priority: 70},
		{Name: "bool", Kind: "type", InsertText: "bool", Priority: 70},
		{Name: "var", Kind: "keyword", InsertText: "var ", Priority: 70},
		{Name: "new", Kind: "keyword", InsertText: "new ", Priority: 70},
		{Name: "return", Kind: "keyword", InsertText: "return ", Priority: 70},
		{Name: "if", Kind: "keyword", InsertText: "if ", Priority: 70},
		{Name: "else", Kind: "keyword", InsertText: "else ", Priority: 70},
		{Name: "for", Kind: "keyword", InsertText: "for ", Priority: 70},
		{Name: "foreach", Kind: "keyword", InsertText: "foreach ", Priority: 70},
		{Name: "while", Kind: "keyword", InsertText: "while ", Priority: 70},
		{Name: "switch", Kind: "keyword", InsertText: "switch ", Priority: 70},
		{Name: "try", Kind: "keyword", InsertText: "try ", Priority: 70},
		{Name: "catch", Kind: "keyword", InsertText: "catch ", Priority: 70},
		{Name: "finally", Kind: "keyword", InsertText: "finally ", Priority: 70},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 70},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
	},
	"clojure": {
		{Name: "def", Kind: "keyword", InsertText: "def ", Priority: 85},
		{Name: "defn", Kind: "keyword", InsertText: "defn ", Priority: 90},
		{Name: "defmacro", Kind: "keyword", InsertText: "defmacro ", Priority: 80},
		{Name: "fn", Kind: "keyword", InsertText: "fn ", Priority: 85},
		{Name: "let", Kind: "keyword", InsertText: "let ", Priority: 90},
		{Name: "if", Kind: "keyword", InsertText: "if ", Priority: 85},
		{Name: "when", Kind: "keyword", InsertText: "when ", Priority: 80},
		{Name: "cond", Kind: "keyword", InsertText: "cond ", Priority: 80},
		{Name: "case", Kind: "keyword", InsertText: "case ", Priority: 80},
		{Name: "do", Kind: "keyword", InsertText: "do ", Priority: 75},
		{Name: "loop", Kind: "keyword", InsertText: "loop ", Priority: 75},
		{Name: "recur", Kind: "keyword", InsertText: "recur ", Priority: 70},
		{Name: "ns", Kind: "keyword", InsertText: "ns ", Priority: 85},
		{Name: "require", Kind: "keyword", InsertText: "require ", Priority: 80},
		{Name: "use", Kind: "keyword", InsertText: "use ", Priority: 70},
		{Name: "import", Kind: "keyword", InsertText: "import ", Priority: 70},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
		{Name: "nil", Kind: "constant", InsertText: "nil", Priority: 70},
	},
	"rust": {
		{Name: "fn", Kind: "keyword", InsertText: "fn ", Priority: 85},
		{Name: "let", Kind: "keyword", InsertText: "let ", Priority: 85},
		{Name: "mut", Kind: "keyword", InsertText: "mut ", Priority: 80},
		{Name: "struct", Kind: "keyword", InsertText: "struct ", Priority: 80},
		{Name: "enum", Kind: "keyword", InsertText: "enum ", Priority: 80},
		{Name: "impl", Kind: "keyword", InsertText: "impl ", Priority: 75},
		{Name: "trait", Kind: "keyword", InsertText: "trait ", Priority: 75},
		{Name: "pub", Kind: "keyword", InsertText: "pub ", Priority: 75},
		{Name: "use", Kind: "keyword", InsertText: "use ", Priority: 75},
		{Name: "mod", Kind: "keyword", InsertText: "mod ", Priority: 70},
		{Name: "crate", Kind: "keyword", InsertText: "crate", Priority: 70},
		{Name: "self", Kind: "keyword", InsertText: "self", Priority: 70},
		{Name: "super", Kind: "keyword", InsertText: "super", Priority: 70},
		{Name: "match", Kind: "keyword", InsertText: "match ", Priority: 70},
		{Name: "if", Kind: "keyword", InsertText: "if ", Priority: 70},
		{Name: "else", Kind: "keyword", InsertText: "else ", Priority: 70},
		{Name: "for", Kind: "keyword", InsertText: "for ", Priority: 70},
		{Name: "while", Kind: "keyword", InsertText: "while ", Priority: 70},
		{Name: "loop", Kind: "keyword", InsertText: "loop ", Priority: 70},
		{Name: "return", Kind: "keyword", InsertText: "return ", Priority: 70},
		{Name: "async", Kind: "keyword", InsertText: "async ", Priority: 70},
		{Name: "await", Kind: "keyword", InsertText: "await ", Priority: 70},
		{Name: "const", Kind: "keyword", InsertText: "const ", Priority: 70},
		{Name: "static", Kind: "keyword", InsertText: "static ", Priority: 70},
		{Name: "Some", Kind: "function", InsertText: "Some", Priority: 65},
		{Name: "None", Kind: "constant", InsertText: "None", Priority: 65},
		{Name: "Ok", Kind: "function", InsertText: "Ok", Priority: 65},
		{Name: "Err", Kind: "function", InsertText: "Err", Priority: 65},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 65},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 65},
	},
	"css": {
		{Name: "color", Kind: "property", InsertText: "color: ", Priority: 80},
		{Name: "background", Kind: "property", InsertText: "background: ", Priority: 80},
		{Name: "background-color", Kind: "property", InsertText: "background-color: ", Priority: 80},
		{Name: "background-image", Kind: "property", InsertText: "background-image: ", Priority: 80},
		{Name: "display", Kind: "property", InsertText: "display: ", Priority: 80},
		{Name: "position", Kind: "property", InsertText: "position: ", Priority: 80},
		{Name: "margin", Kind: "property", InsertText: "margin: ", Priority: 75},
		{Name: "padding", Kind: "property", InsertText: "padding: ", Priority: 75},
		{Name: "font-size", Kind: "property", InsertText: "font-size: ", Priority: 75},
		{Name: "font-weight", Kind: "property", InsertText: "font-weight: ", Priority: 75},
		{Name: "line-height", Kind: "property", InsertText: "line-height: ", Priority: 75},
		{Name: "width", Kind: "property", InsertText: "width: ", Priority: 75},
		{Name: "height", Kind: "property", InsertText: "height: ", Priority: 75},
		{Name: "max-width", Kind: "property", InsertText: "max-width: ", Priority: 70},
		{Name: "min-width", Kind: "property", InsertText: "min-width: ", Priority: 70},
		{Name: "border", Kind: "property", InsertText: "border: ", Priority: 70},
		{Name: "border-radius", Kind: "property", InsertText: "border-radius: ", Priority: 70},
		{Name: "box-shadow", Kind: "property", InsertText: "box-shadow: ", Priority: 70},
		{Name: "flex", Kind: "property", InsertText: "flex: ", Priority: 70},
		{Name: "grid", Kind: "property", InsertText: "grid: ", Priority: 70},
		{Name: "align-items", Kind: "property", InsertText: "align-items: ", Priority: 70},
		{Name: "justify-content", Kind: "property", InsertText: "justify-content: ", Priority: 70},
		{Name: "gap", Kind: "property", InsertText: "gap: ", Priority: 70},
		{Name: "@import", Kind: "keyword", InsertText: "@import ", Priority: 75},
		{Name: "@media", Kind: "keyword", InsertText: "@media ", Priority: 75},
		{Name: "@supports", Kind: "keyword", InsertText: "@supports ", Priority: 70},
		{Name: "@keyframes", Kind: "keyword", InsertText: "@keyframes ", Priority: 70},
		{Name: "@font-face", Kind: "keyword", InsertText: "@font-face ", Priority: 70},
		{Name: "@layer", Kind: "keyword", InsertText: "@layer ", Priority: 65},
	},
	"scala": {
		{Name: "object", Kind: "keyword", InsertText: "object ${1:Name} {\n\t$0\n}", Priority: 85},
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name} {\n\t$0\n}", Priority: 85},
		{Name: "trait", Kind: "keyword", InsertText: "trait ${1:Name} {\n\t$0\n}", Priority: 80},
		{Name: "def", Kind: "keyword", InsertText: "def ${1:name}($2): $3 = {\n\t$0\n}", Priority: 85},
		{Name: "val", Kind: "keyword", InsertText: "val $1 = $2", Priority: 80},
		{Name: "var", Kind: "keyword", InsertText: "var $1 = $2", Priority: 75},
		{Name: "import", Kind: "keyword", InsertText: "import $1", Priority: 80},
		{Name: "package", Kind: "keyword", InsertText: "package $1", Priority: 80},
		{Name: "extends", Kind: "keyword", InsertText: "extends $1", Priority: 75},
		{Name: "with", Kind: "keyword", InsertText: "with $1", Priority: 70},
		{Name: "match", Kind: "keyword", InsertText: "match {\n\tcase $1 => $0\n}", Priority: 75},
		{Name: "case", Kind: "keyword", InsertText: "case $1 => $0", Priority: 75},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 75},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 75},
		{Name: "for", Kind: "keyword", InsertText: "for ($1 <- $2) yield $0", Priority: 70},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch {\n\tcase $2 => $0\n}", Priority: 70},
		{Name: "new", Kind: "keyword", InsertText: "new $1", Priority: 75},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
		{Name: "None", Kind: "constant", InsertText: "None", Priority: 65},
		{Name: "Some", Kind: "class", InsertText: "Some($1)", Priority: 65},
	},
	"groovy": {
		{Name: "class", Kind: "keyword", InsertText: "class ${1:Name} {\n\t$0\n}", Priority: 85},
		{Name: "interface", Kind: "keyword", InsertText: "interface ${1:Name} {\n\t$0\n}", Priority: 80},
		{Name: "trait", Kind: "keyword", InsertText: "trait ${1:Name} {\n\t$0\n}", Priority: 78},
		{Name: "def", Kind: "keyword", InsertText: "def ${1:name}($2) {\n\t$0\n}", Priority: 85},
		{Name: "import", Kind: "keyword", InsertText: "import $1", Priority: 80},
		{Name: "package", Kind: "keyword", InsertText: "package $1", Priority: 80},
		{Name: "extends", Kind: "keyword", InsertText: "extends $1", Priority: 75},
		{Name: "implements", Kind: "keyword", InsertText: "implements $1", Priority: 75},
		{Name: "return", Kind: "keyword", InsertText: "return $1", Priority: 80},
		{Name: "if", Kind: "keyword", InsertText: "if ($1) {\n\t$0\n}", Priority: 80},
		{Name: "else", Kind: "keyword", InsertText: "else {\n\t$0\n}", Priority: 75},
		{Name: "for", Kind: "keyword", InsertText: "for (${1:item} in $2) {\n\t$0\n}", Priority: 75},
		{Name: "while", Kind: "keyword", InsertText: "while ($1) {\n\t$0\n}", Priority: 75},
		{Name: "try", Kind: "keyword", InsertText: "try {\n\t$1\n} catch ($2) {\n\t$0\n}", Priority: 70},
		{Name: "catch", Kind: "keyword", InsertText: "catch ($1) {\n\t$0\n}", Priority: 70},
		{Name: "finally", Kind: "keyword", InsertText: "finally {\n\t$0\n}", Priority: 70},
		{Name: "new", Kind: "keyword", InsertText: "new $1()", Priority: 78},
		{Name: "null", Kind: "constant", InsertText: "null", Priority: 70},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
		{Name: "println", Kind: "function", InsertText: "println($1)", Priority: 75},
	},
	"erlang": {
		{Name: "module", Kind: "keyword", InsertText: "-module($1).", Priority: 90},
		{Name: "export", Kind: "keyword", InsertText: "-export([$1/$2]).", Priority: 85},
		{Name: "import", Kind: "keyword", InsertText: "-import($1, [$2/$3]).", Priority: 75},
		{Name: "define", Kind: "keyword", InsertText: "-define($1, $2).", Priority: 70},
		{Name: "fun", Kind: "keyword", InsertText: "fun($1) ->\n    $0\nend", Priority: 80},
		{Name: "case", Kind: "keyword", InsertText: "case $1 of\n    $0\nend", Priority: 80},
		{Name: "receive", Kind: "keyword", InsertText: "receive\n    $0\nend", Priority: 75},
		{Name: "if", Kind: "keyword", InsertText: "if\n    $1 -> $0\nend", Priority: 70},
		{Name: "when", Kind: "keyword", InsertText: "when $1", Priority: 65},
		{Name: "true", Kind: "constant", InsertText: "true", Priority: 70},
		{Name: "false", Kind: "constant", InsertText: "false", Priority: 70},
	},
	"bash": {
		{Name: "if", Kind: "keyword", InsertText: "if $1; then\n\t$0\nfi", Priority: 80},
		{Name: "for", Kind: "keyword", InsertText: "for $1 in $2; do\n\t$0\ndone", Priority: 75},
		{Name: "while", Kind: "keyword", InsertText: "while $1; do\n\t$0\ndone", Priority: 75},
		{Name: "case", Kind: "keyword", InsertText: "case $1 in\n\t$0\nesac", Priority: 70},
		{Name: "function", Kind: "keyword", InsertText: "function ${1:name}() {\n\t$0\n}", Priority: 70},
		{Name: "echo", Kind: "function", InsertText: "echo ", Priority: 75},
		{Name: "printf", Kind: "function", InsertText: "printf ", Priority: 70},
		{Name: "read", Kind: "function", InsertText: "read ", Priority: 70},
		{Name: "test", Kind: "function", InsertText: "test ", Priority: 65},
		{Name: "[", Kind: "keyword", InsertText: "[ ", Priority: 60},
		{Name: "[[", Kind: "keyword", InsertText: "[[ ", Priority: 60},
		{Name: "export", Kind: "keyword", InsertText: "export VAR=", Priority: 75},
	},
	"dockerfile": {
		{Name: "FROM", Kind: "keyword", InsertText: "FROM $1", Priority: 90},
		{Name: "RUN", Kind: "keyword", InsertText: "RUN $1", Priority: 80},
		{Name: "CMD", Kind: "keyword", InsertText: "CMD [\"$1\"]", Priority: 75},
		{Name: "COPY", Kind: "keyword", InsertText: "COPY $1 $2", Priority: 80},
		{Name: "ADD", Kind: "keyword", InsertText: "ADD $1 $2", Priority: 70},
		{Name: "WORKDIR", Kind: "keyword", InsertText: "WORKDIR $1", Priority: 75},
		{Name: "EXPOSE", Kind: "keyword", InsertText: "EXPOSE $1", Priority: 70},
		{Name: "ENV", Kind: "keyword", InsertText: "ENV $1=$2", Priority: 75},
		{Name: "ARG", Kind: "keyword", InsertText: "ARG $1", Priority: 70},
		{Name: "ENTRYPOINT", Kind: "keyword", InsertText: "ENTRYPOINT [\"$1\"]", Priority: 70},
	},
	"yaml": {
		{Name: "version", Kind: "property", InsertText: "version: $1", Priority: 70},
		{Name: "services", Kind: "property", InsertText: "services:\n  $1:\n    $0", Priority: 75},
		{Name: "image", Kind: "property", InsertText: "image: $1", Priority: 70},
		{Name: "build", Kind: "property", InsertText: "build: $1", Priority: 65},
		{Name: "ports", Kind: "property", InsertText: "ports:\n  - \"$1:$2\"", Priority: 70},
		{Name: "volumes", Kind: "property", InsertText: "volumes:\n  - $1:$2", Priority: 70},
		{Name: "environment", Kind: "property", InsertText: "environment:\n  - $1=$2", Priority: 65},
		{Name: "depends_on", Kind: "property", InsertText: "depends_on:\n  - $1", Priority: 65},
	},
	"terraform": {
		{Name: "resource", Kind: "keyword", InsertText: "resource \"$1\" \"$2\" {\n  $0\n}", Priority: 80},
		{Name: "variable", Kind: "keyword", InsertText: "variable \"$1\" {\n  type = $2\n}\n", Priority: 70},
		{Name: "output", Kind: "keyword", InsertText: "output \"$1\" {\n  value = $2\n}\n", Priority: 70},
		{Name: "provider", Kind: "keyword", InsertText: "provider \"$1\" {\n  $0\n}", Priority: 70},
		{Name: "module", Kind: "keyword", InsertText: "module \"$1\" {\n  source = \"$2\"\n}\n", Priority: 65},
		{Name: "locals", Kind: "keyword", InsertText: "locals {\n  $0\n}", Priority: 60},
	},
	"makefile": {
		{Name: ".PHONY", Kind: "keyword", InsertText: ".PHONY: $1", Priority: 70},
		{Name: "all", Kind: "keyword", InsertText: "all:\n\t$0", Priority: 65},
		{Name: "clean", Kind: "keyword", InsertText: "clean:\n\trm -rf $1", Priority: 60},
	},
	"nginx": {
		{Name: "server", Kind: "keyword", InsertText: "server {\n\t$0\n}", Priority: 80},
		{Name: "location", Kind: "keyword", InsertText: "location / {\n\t$0\n}", Priority: 80},
		{Name: "listen", Kind: "property", InsertText: "listen ", Priority: 75},
		{Name: "server_name", Kind: "property", InsertText: "server_name ", Priority: 75},
		{Name: "root", Kind: "property", InsertText: "root ", Priority: 70},
		{Name: "index", Kind: "property", InsertText: "index ", Priority: 70},
		{Name: "proxy_pass", Kind: "property", InsertText: "proxy_pass ", Priority: 70},
		{Name: "return", Kind: "property", InsertText: "return ", Priority: 70},
		{Name: "include", Kind: "property", InsertText: "include ", Priority: 65},
		{Name: "try_files", Kind: "property", InsertText: "try_files ", Priority: 65},
		{Name: "rewrite", Kind: "property", InsertText: "rewrite ", Priority: 65},
		{Name: "error_page", Kind: "property", InsertText: "error_page ", Priority: 65},
		{Name: "access_log", Kind: "property", InsertText: "access_log ", Priority: 60},
		{Name: "client_max_body_size", Kind: "property", InsertText: "client_max_body_size ", Priority: 60},
		{Name: "upstream", Kind: "keyword", InsertText: "upstream ", Priority: 70},
	},
	"ini": {
		{Name: "section", Kind: "property", InsertText: "[$1]", Priority: 60},
		{Name: "key", Kind: "property", InsertText: "$1=$2", Priority: 60},
	},
	"env": {
		{Name: "KEY", Kind: "property", InsertText: "KEY=$1", Priority: 60},
	},
	"sql": {
		{Name: "SELECT", Kind: "keyword", InsertText: "SELECT", Priority: 95},
		{Name: "FROM", Kind: "keyword", InsertText: "FROM", Priority: 94},
		{Name: "WHERE", Kind: "keyword", InsertText: "WHERE", Priority: 93},
		{Name: "INSERT", Kind: "keyword", InsertText: "INSERT", Priority: 90},
		{Name: "INTO", Kind: "keyword", InsertText: "INTO", Priority: 88},
		{Name: "VALUES", Kind: "keyword", InsertText: "VALUES", Priority: 88},
		{Name: "UPDATE", Kind: "keyword", InsertText: "UPDATE", Priority: 90},
		{Name: "SET", Kind: "keyword", InsertText: "SET", Priority: 86},
		{Name: "DELETE", Kind: "keyword", InsertText: "DELETE", Priority: 90},
		{Name: "CREATE", Kind: "keyword", InsertText: "CREATE", Priority: 85},
		{Name: "ALTER", Kind: "keyword", InsertText: "ALTER", Priority: 80},
		{Name: "DROP", Kind: "keyword", InsertText: "DROP", Priority: 80},
		{Name: "TABLE", Kind: "keyword", InsertText: "TABLE", Priority: 82},
		{Name: "VIEW", Kind: "keyword", InsertText: "VIEW", Priority: 72},
		{Name: "INDEX", Kind: "keyword", InsertText: "INDEX", Priority: 72},
		{Name: "JOIN", Kind: "keyword", InsertText: "JOIN", Priority: 85},
		{Name: "INNER JOIN", Kind: "keyword", InsertText: "INNER JOIN", Priority: 82},
		{Name: "LEFT JOIN", Kind: "keyword", InsertText: "LEFT JOIN", Priority: 82},
		{Name: "RIGHT JOIN", Kind: "keyword", InsertText: "RIGHT JOIN", Priority: 78},
		{Name: "FULL JOIN", Kind: "keyword", InsertText: "FULL JOIN", Priority: 74},
		{Name: "CROSS JOIN", Kind: "keyword", InsertText: "CROSS JOIN", Priority: 72},
		{Name: "ON", Kind: "keyword", InsertText: "ON", Priority: 80},
		{Name: "GROUP BY", Kind: "keyword", InsertText: "GROUP BY", Priority: 82},
		{Name: "ORDER BY", Kind: "keyword", InsertText: "ORDER BY", Priority: 82},
		{Name: "HAVING", Kind: "keyword", InsertText: "HAVING", Priority: 75},
		{Name: "LIMIT", Kind: "keyword", InsertText: "LIMIT", Priority: 78},
		{Name: "OFFSET", Kind: "keyword", InsertText: "OFFSET", Priority: 74},
		{Name: "DISTINCT", Kind: "keyword", InsertText: "DISTINCT", Priority: 78},
		{Name: "AS", Kind: "keyword", InsertText: "AS", Priority: 76},
		{Name: "AND", Kind: "operator", InsertText: "AND", Priority: 76},
		{Name: "OR", Kind: "operator", InsertText: "OR", Priority: 74},
		{Name: "NOT", Kind: "operator", InsertText: "NOT", Priority: 72},
		{Name: "NULL", Kind: "constant", InsertText: "NULL", Priority: 72},
		{Name: "IS NULL", Kind: "operator", InsertText: "IS NULL", Priority: 70},
		{Name: "IS NOT NULL", Kind: "operator", InsertText: "IS NOT NULL", Priority: 68},
		{Name: "IN", Kind: "operator", InsertText: "IN", Priority: 72},
		{Name: "BETWEEN", Kind: "operator", InsertText: "BETWEEN", Priority: 70},
		{Name: "LIKE", Kind: "operator", InsertText: "LIKE", Priority: 70},
		{Name: "EXISTS", Kind: "operator", InsertText: "EXISTS", Priority: 68},
		{Name: "CASE", Kind: "keyword", InsertText: "CASE", Priority: 72},
		{Name: "WHEN", Kind: "keyword", InsertText: "WHEN", Priority: 70},
		{Name: "THEN", Kind: "keyword", InsertText: "THEN", Priority: 68},
		{Name: "ELSE", Kind: "keyword", InsertText: "ELSE", Priority: 68},
		{Name: "END", Kind: "keyword", InsertText: "END", Priority: 68},
		{Name: "UNION", Kind: "keyword", InsertText: "UNION", Priority: 72},
		{Name: "WITH", Kind: "keyword", InsertText: "WITH", Priority: 72},
		{Name: "COUNT", Kind: "function", InsertText: "COUNT", Priority: 76},
		{Name: "SUM", Kind: "function", InsertText: "SUM", Priority: 72},
		{Name: "AVG", Kind: "function", InsertText: "AVG", Priority: 72},
		{Name: "MIN", Kind: "function", InsertText: "MIN", Priority: 70},
		{Name: "MAX", Kind: "function", InsertText: "MAX", Priority: 70},
		{Name: "COALESCE", Kind: "function", InsertText: "COALESCE", Priority: 70},
	},
}

type KeywordInfo struct {
	Name       string
	Kind       string
	InsertText string
	Priority   int
}

var primitiveTypeKeywords = map[string][]KeywordInfo{
	"go": {
		{Name: "string", Kind: "type", InsertText: "string", Priority: 100},
		{Name: "int", Kind: "type", InsertText: "int", Priority: 98},
		{Name: "bool", Kind: "type", InsertText: "bool", Priority: 96},
		{Name: "float32", Kind: "type", InsertText: "float32", Priority: 94},
		{Name: "float64", Kind: "type", InsertText: "float64", Priority: 93},
		{Name: "error", Kind: "type", InsertText: "error", Priority: 90},
		{Name: "[]byte", Kind: "type", InsertText: "[]byte", Priority: 86},
		{Name: "rune", Kind: "type", InsertText: "rune", Priority: 84},
		{Name: "byte", Kind: "type", InsertText: "byte", Priority: 83},
		{Name: "int8", Kind: "type", InsertText: "int8", Priority: 78},
		{Name: "int16", Kind: "type", InsertText: "int16", Priority: 77},
		{Name: "int32", Kind: "type", InsertText: "int32", Priority: 76},
		{Name: "int64", Kind: "type", InsertText: "int64", Priority: 75},
		{Name: "uint", Kind: "type", InsertText: "uint", Priority: 74},
		{Name: "uint8", Kind: "type", InsertText: "uint8", Priority: 73},
		{Name: "uint16", Kind: "type", InsertText: "uint16", Priority: 72},
		{Name: "uint32", Kind: "type", InsertText: "uint32", Priority: 71},
		{Name: "uint64", Kind: "type", InsertText: "uint64", Priority: 70},
		{Name: "time.Time", Kind: "type", InsertText: "time.Time", Priority: 69},
		{Name: "context.Context", Kind: "type", InsertText: "context.Context", Priority: 68},
	},
	"php": {
		{Name: "string", Kind: "type", InsertText: "string", Priority: 100},
		{Name: "int", Kind: "type", InsertText: "int", Priority: 98},
		{Name: "float", Kind: "type", InsertText: "float", Priority: 96},
		{Name: "bool", Kind: "type", InsertText: "bool", Priority: 94},
		{Name: "array", Kind: "type", InsertText: "array", Priority: 90},
		{Name: "mixed", Kind: "type", InsertText: "mixed", Priority: 86},
		{Name: "object", Kind: "type", InsertText: "object", Priority: 82},
	},
	"typescript": {
		{Name: "string", Kind: "type", InsertText: "string", Priority: 100},
		{Name: "number", Kind: "type", InsertText: "number", Priority: 98},
		{Name: "boolean", Kind: "type", InsertText: "boolean", Priority: 96},
		{Name: "unknown", Kind: "type", InsertText: "unknown", Priority: 90},
		{Name: "any", Kind: "type", InsertText: "any", Priority: 82},
		{Name: "void", Kind: "type", InsertText: "void", Priority: 78},
	},
	"javascript": {
		{Name: "string", Kind: "type", InsertText: "string", Priority: 100},
		{Name: "number", Kind: "type", InsertText: "number", Priority: 98},
		{Name: "boolean", Kind: "type", InsertText: "boolean", Priority: 96},
		{Name: "object", Kind: "type", InsertText: "object", Priority: 90},
		{Name: "Array", Kind: "type", InsertText: "Array", Priority: 86},
	},
	"java": {
		{Name: "int", Kind: "type", InsertText: "int", Priority: 100},
		{Name: "long", Kind: "type", InsertText: "long", Priority: 98},
		{Name: "float", Kind: "type", InsertText: "float", Priority: 96},
		{Name: "double", Kind: "type", InsertText: "double", Priority: 94},
		{Name: "boolean", Kind: "type", InsertText: "boolean", Priority: 92},
		{Name: "String", Kind: "type", InsertText: "String", Priority: 90},
	},
	"csharp": {
		{Name: "int", Kind: "type", InsertText: "int", Priority: 100},
		{Name: "long", Kind: "type", InsertText: "long", Priority: 98},
		{Name: "float", Kind: "type", InsertText: "float", Priority: 96},
		{Name: "double", Kind: "type", InsertText: "double", Priority: 94},
		{Name: "decimal", Kind: "type", InsertText: "decimal", Priority: 92},
		{Name: "bool", Kind: "type", InsertText: "bool", Priority: 90},
		{Name: "string", Kind: "type", InsertText: "string", Priority: 88},
	},
	"rust": {
		{Name: "String", Kind: "type", InsertText: "String", Priority: 100},
		{Name: "str", Kind: "type", InsertText: "str", Priority: 98},
		{Name: "i32", Kind: "type", InsertText: "i32", Priority: 96},
		{Name: "i64", Kind: "type", InsertText: "i64", Priority: 94},
		{Name: "u32", Kind: "type", InsertText: "u32", Priority: 92},
		{Name: "u64", Kind: "type", InsertText: "u64", Priority: 90},
		{Name: "f32", Kind: "type", InsertText: "f32", Priority: 88},
		{Name: "f64", Kind: "type", InsertText: "f64", Priority: 86},
		{Name: "bool", Kind: "type", InsertText: "bool", Priority: 84},
	},
}

func GetKeywordsForLanguage(language string) []KeywordInfo {
	if keywords, ok := LanguageKeywords[language]; ok {
		return keywords
	}
	return nil
}

func GetMatchingKeywords(language, prefix string) []KeywordInfo {
	keywords := GetKeywordsForLanguage(language)
	if keywords == nil {
		return nil
	}

	// Don't return all keywords when prefix is empty - too noisy
	if prefix == "" {
		return nil
	}

	prefixLower := strings.ToLower(prefix)
	var matched []KeywordInfo
	for _, kw := range keywords {
		if strings.HasPrefix(strings.ToLower(kw.Name), prefixLower) {
			matched = append(matched, kw)
		}
	}
	return matched
}

func GetPrimitiveTypeKeywords(language, prefix string) []KeywordInfo {
	keywords, ok := primitiveTypeKeywords[language]
	if !ok {
		return nil
	}

	prefixLower := strings.ToLower(prefix)
	var matched []KeywordInfo
	for _, kw := range keywords {
		if prefixLower == "" || strings.HasPrefix(strings.ToLower(kw.Name), prefixLower) {
			matched = append(matched, kw)
		}
	}
	return matched
}

// GetContextualKeywords returns keywords appropriate for a specific context
// For example, after "type" in Go, only return "struct" and "interface"
func GetContextualKeywords(language, context, prefix string) []KeywordInfo {
	var contextKeywords []KeywordInfo

	switch language {
	case "go":
		switch context {
		case "after_type":
			// After "type Name" only struct/interface make sense
			contextKeywords = []KeywordInfo{
				{Name: "struct", Kind: "keyword", InsertText: "struct {\n$0\n}", Priority: 95},
				{Name: "interface", Kind: "keyword", InsertText: "interface {\n$0\n}", Priority: 90},
			}
		case "struct_field_type":
			contextKeywords = GetPrimitiveTypeKeywords(language, prefix)
		}
	case "bash":
		switch context {
		case "after_dollar":
			contextKeywords = bashDollarKeywords
		case "after_echo":
			contextKeywords = []KeywordInfo{
				{Name: "$VAR", Kind: "variable", InsertText: "", Priority: 90},
				{Name: "\"$VAR\"", Kind: "variable", InsertText: "", Priority: 85},
			}
		case "after_read":
			contextKeywords = []KeywordInfo{
				{Name: "-p \"prompt\" VAR", Kind: "snippet", InsertText: "-p \"prompt\" VAR", Priority: 90},
				{Name: "VAR", Kind: "variable", InsertText: "VAR", Priority: 80},
			}
		case "after_export":
			contextKeywords = []KeywordInfo{
				{Name: "VAR=", Kind: "keyword", InsertText: "VAR=", Priority: 80},
			}
		case "after_test":
			contextKeywords = []KeywordInfo{
				{Name: "-f \"$FILE\" ]", Kind: "snippet", InsertText: "", Priority: 80},
				{Name: "-d \"$DIR\" ]", Kind: "snippet", InsertText: "", Priority: 80},
				{Name: "-n \"$VAR\" ]", Kind: "snippet", InsertText: "", Priority: 75},
			}
		}
	case "css":
		if context == "after_colon" {
			contextKeywords = cssValueKeywords
		}
	case "astro":
		switch context {
		case "after_lt":
			contextKeywords = htmlTagKeywords
		case "astro_globals":
			contextKeywords = astroGlobalKeywords
		}
	case "html", "blade", "vue", "svelte":
		if context == "after_lt" {
			contextKeywords = htmlTagKeywords
		}
	}

	if len(contextKeywords) == 0 {
		return GetMatchingKeywords(language, prefix)
	}

	if prefix == "" {
		return contextKeywords
	}

	prefixLower := strings.ToLower(prefix)
	var matched []KeywordInfo
	for _, kw := range contextKeywords {
		if strings.HasPrefix(strings.ToLower(kw.Name), prefixLower) {
			matched = append(matched, kw)
		}
	}
	return matched
}
