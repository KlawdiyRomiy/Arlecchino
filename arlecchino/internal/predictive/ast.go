package predictive

import (
	"fmt"
	"strings"
	"unicode"

	sitter "github.com/smacker/go-tree-sitter"
)

type ASTAnalyzer struct {
	safeParser *SafeParser
}

type ASTContext struct {
	InClass     bool
	InMethod    bool
	InFunction  bool
	InInterface bool
	InTrait     bool

	ClassName     string
	MethodName    string
	FunctionName  string
	InterfaceName string
	TraitName     string

	ParentClass string
	Implements  []string
	Uses        []string

	Context    PositionContext
	Scope      string
	NodeType   string
	ParentType string

	Namespace string
	Imports   []string

	CurrentPrefix string
	InString      bool
	StringContent string
	AccessChain   string
}

func NewASTAnalyzer() *ASTAnalyzer {
	return &ASTAnalyzer{
		safeParser: GetSafeParser(),
	}
}

func (a *ASTAnalyzer) AnalyzePosition(language string, content []byte, line, column int) (*ASTContext, error) {
	tree, err := a.safeParser.Parse(language, content)
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}
	if tree == nil {
		return nil, fmt.Errorf("unsupported language: %s", language)
	}
	defer tree.Close()

	root := tree.RootNode()
	if root == nil {
		return &ASTContext{Context: PositionContextFileStart}, nil
	}

	point := sitter.Point{Row: uint32(line - 1), Column: uint32(column)}
	node := root.NamedDescendantForPointRange(point, point)

	ctx := &ASTContext{}

	prefix, accessChain := extractPrefixWithAccessChain(content, line, column, language)
	ctx.CurrentPrefix = prefix
	ctx.AccessChain = accessChain

	a.extractNamespaceAndImports(root, content, ctx, language)
	a.analyzeNode(node, content, ctx, language)

	if ctx.ClassName == "" {
		a.extractFileClass(root, content, ctx, language)
	}

	return ctx, nil
}

func (a *ASTAnalyzer) analyzeNode(node *sitter.Node, content []byte, ctx *ASTContext, language string) {
	if node == nil {
		ctx.Context = PositionContextFileStart
		return
	}

	ctx.NodeType = node.Type()

	current := node
	for current != nil {
		nodeType := current.Type()

		switch language {
		case "php":
			a.analyzePHPNode(current, content, ctx)
		case "go":
			a.analyzeGoNode(current, content, ctx)
		case "typescript", "javascript", "typescriptreact", "javascriptreact", "tsx", "jsx", "ts", "js":
			a.analyzeJSNode(current, content, ctx)
		case "python", "py":
			a.analyzePythonNode(current, content, ctx)
		case "ruby", "rb":
			a.analyzeRubyNode(current, content, ctx)
		}

		if current.Parent() != nil && ctx.ParentType == "" {
			ctx.ParentType = current.Parent().Type()
		}

		current = current.Parent()

		if nodeType != "" && ctx.NodeType == node.Type() {
			if isSignificantNode(nodeType) {
				ctx.ParentType = nodeType
			}
		}
	}

	ctx.Context = a.determinePositionContext(ctx)
}

func isSignificantNode(nodeType string) bool {
	significant := map[string]bool{
		"class_declaration":     true,
		"class_definition":      true,
		"method_declaration":    true,
		"method_definition":     true,
		"function_declaration":  true,
		"function_definition":   true,
		"interface_declaration": true,
		"trait_declaration":     true,
		"declaration_list":      true,
		"class_body":            true,
		"block":                 true,
		"compound_statement":    true,
		"class":                 true,
		"module":                true,
		"method":                true,
		"singleton_method":      true,
		"body_statement":        true,
		"do_block":              true,
	}
	return significant[nodeType]
}

func (a *ASTAnalyzer) analyzePHPNode(node *sitter.Node, content []byte, ctx *ASTContext) {
	switch node.Type() {
	case "class_declaration":
		ctx.InClass = true
		if name := a.findChildByType(node, "name"); name != nil {
			ctx.ClassName = name.Content(content)
		}
		if extends := a.findChildByType(node, "base_clause"); extends != nil {
			if name := a.findChildByType(extends, "name"); name != nil {
				ctx.ParentClass = name.Content(content)
			}
		}
		if impl := a.findChildByType(node, "class_interface_clause"); impl != nil {
			for i := uint32(0); i < impl.ChildCount(); i++ {
				child := impl.Child(int(i))
				if child.Type() == "name" {
					ctx.Implements = append(ctx.Implements, child.Content(content))
				}
			}
		}

	case "method_declaration":
		ctx.InMethod = true
		if name := a.findChildByType(node, "name"); name != nil {
			ctx.MethodName = name.Content(content)
		}
		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			if child.Type() == "visibility_modifier" {
				ctx.Scope = child.Content(content)
			}
		}

	case "function_definition":
		ctx.InFunction = true
		if name := a.findChildByType(node, "name"); name != nil {
			ctx.FunctionName = name.Content(content)
		}

	case "interface_declaration":
		ctx.InInterface = true
		if name := a.findChildByType(node, "name"); name != nil {
			ctx.InterfaceName = name.Content(content)
		}

	case "trait_declaration":
		ctx.InTrait = true
		if name := a.findChildByType(node, "name"); name != nil {
			ctx.TraitName = name.Content(content)
		}

	case "anonymous_function_creation_expression", "arrow_function":
		ctx.InFunction = true
		ctx.FunctionName = "<closure>"
	}
}

func (a *ASTAnalyzer) analyzeGoNode(node *sitter.Node, content []byte, ctx *ASTContext) {
	switch node.Type() {
	case "type_declaration":
		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			if child.Type() == "type_spec" {
				if name := a.findChildByType(child, "type_identifier"); name != nil {
					ctx.ClassName = name.Content(content)
					if a.findChildByType(child, "interface_type") != nil {
						ctx.InInterface = true
						ctx.InterfaceName = ctx.ClassName
					} else {
						ctx.InClass = true
					}
				}
			}
		}

	case "method_declaration":
		ctx.InMethod = true
		if name := a.findChildByType(node, "field_identifier"); name != nil {
			ctx.MethodName = name.Content(content)
		}
		if recv := a.findChildByType(node, "parameter_list"); recv != nil {
			if param := a.findChildByType(recv, "parameter_declaration"); param != nil {
				for i := uint32(0); i < param.ChildCount(); i++ {
					child := param.Child(int(i))
					if child.Type() == "type_identifier" || child.Type() == "pointer_type" {
						ctx.ClassName = strings.TrimPrefix(child.Content(content), "*")
						ctx.InClass = true
					}
				}
			}
		}

	case "function_declaration":
		ctx.InFunction = true
		if name := a.findChildByType(node, "identifier"); name != nil {
			ctx.FunctionName = name.Content(content)
		}
	}
}

func (a *ASTAnalyzer) analyzeJSNode(node *sitter.Node, content []byte, ctx *ASTContext) {
	switch node.Type() {
	case "class_declaration", "class":
		ctx.InClass = true
		if name := a.findChildByType(node, "type_identifier"); name != nil {
			ctx.ClassName = name.Content(content)
		} else if name := a.findChildByType(node, "identifier"); name != nil {
			ctx.ClassName = name.Content(content)
		}
		if heritage := a.findChildByType(node, "class_heritage"); heritage != nil {
			if ext := a.findChildByType(heritage, "extends_clause"); ext != nil {
				if name := a.findChildByType(ext, "type_identifier"); name != nil {
					ctx.ParentClass = name.Content(content)
				} else if name := a.findChildByType(ext, "identifier"); name != nil {
					ctx.ParentClass = name.Content(content)
				}
			}
			if impl := a.findChildByType(heritage, "implements_clause"); impl != nil {
				for i := uint32(0); i < impl.ChildCount(); i++ {
					child := impl.Child(int(i))
					if child.Type() == "type_identifier" {
						ctx.Implements = append(ctx.Implements, child.Content(content))
					}
				}
			}
		}

	case "export_statement":
		if classDecl := a.findChildByType(node, "class_declaration"); classDecl != nil {
			a.analyzeJSNode(classDecl, content, ctx)
		} else if classNode := a.findChildByType(node, "class"); classNode != nil {
			a.analyzeJSNode(classNode, content, ctx)
		}

	case "class_body":
		if parent := node.Parent(); parent != nil {
			if parent.Type() == "class_declaration" || parent.Type() == "class" {
				a.analyzeJSNode(parent, content, ctx)
			}
		}

	case "method_definition":
		ctx.InMethod = true
		if name := a.findChildByType(node, "property_identifier"); name != nil {
			ctx.MethodName = name.Content(content)
		}

	case "function_declaration":
		ctx.InFunction = true
		if name := a.findChildByType(node, "identifier"); name != nil {
			ctx.FunctionName = name.Content(content)
		}

	case "arrow_function", "function_expression":
		ctx.InFunction = true
		if parent := node.Parent(); parent != nil && parent.Type() == "variable_declarator" {
			if name := a.findChildByType(parent, "identifier"); name != nil {
				ctx.FunctionName = name.Content(content)
			}
		}

	case "interface_declaration":
		ctx.InInterface = true
		if name := a.findChildByType(node, "type_identifier"); name != nil {
			ctx.InterfaceName = name.Content(content)
		}
	}
}

func (a *ASTAnalyzer) analyzePythonNode(node *sitter.Node, content []byte, ctx *ASTContext) {
	switch node.Type() {
	case "class_definition":
		ctx.InClass = true
		if name := a.findChildByType(node, "identifier"); name != nil {
			ctx.ClassName = name.Content(content)
		}
		if args := a.findChildByType(node, "argument_list"); args != nil {
			for i := uint32(0); i < args.ChildCount(); i++ {
				child := args.Child(int(i))
				if child.Type() == "identifier" {
					if ctx.ParentClass == "" {
						ctx.ParentClass = child.Content(content)
					} else {
						ctx.Implements = append(ctx.Implements, child.Content(content))
					}
				}
			}
		}

	case "block":
		if parent := node.Parent(); parent != nil {
			if parent.Type() == "class_definition" {
				a.analyzePythonNode(parent, content, ctx)
			} else if parent.Type() == "function_definition" {
				grandparent := parent.Parent()
				if grandparent != nil && grandparent.Type() == "block" {
					greatGrandparent := grandparent.Parent()
					if greatGrandparent != nil && greatGrandparent.Type() == "class_definition" {
						a.analyzePythonNode(greatGrandparent, content, ctx)
						ctx.InMethod = true
						if name := a.findChildByType(parent, "identifier"); name != nil {
							ctx.MethodName = name.Content(content)
						}
					}
				}
			}
		}

	case "function_definition":
		if ctx.InClass {
			ctx.InMethod = true
			if name := a.findChildByType(node, "identifier"); name != nil {
				ctx.MethodName = name.Content(content)
			}
		} else {
			ctx.InFunction = true
			if name := a.findChildByType(node, "identifier"); name != nil {
				ctx.FunctionName = name.Content(content)
			}
		}
	}
}

func (a *ASTAnalyzer) analyzeRubyNode(node *sitter.Node, content []byte, ctx *ASTContext) {
	switch node.Type() {
	case "class":
		ctx.InClass = true
		if name := a.findChildByType(node, "constant"); name != nil {
			ctx.ClassName = name.Content(content)
		}
		if superclass := a.findChildByType(node, "superclass"); superclass != nil {
			if name := a.findChildByType(superclass, "constant"); name != nil {
				ctx.ParentClass = name.Content(content)
			}
		}

	case "module":
		ctx.InClass = true
		if name := a.findChildByType(node, "constant"); name != nil {
			ctx.ClassName = name.Content(content)
		}

	case "method":
		if ctx.InClass {
			ctx.InMethod = true
		} else {
			ctx.InFunction = true
		}
		if name := a.findChildByType(node, "identifier"); name != nil {
			methodName := name.Content(content)
			if ctx.InMethod {
				ctx.MethodName = methodName
			} else {
				ctx.FunctionName = methodName
			}
		}

	case "singleton_method":
		ctx.InMethod = true
		if name := a.findChildByType(node, "identifier"); name != nil {
			ctx.MethodName = name.Content(content)
		}

	case "body_statement":
		if parent := node.Parent(); parent != nil {
			switch parent.Type() {
			case "class", "module":
				a.analyzeRubyNode(parent, content, ctx)
			case "method", "singleton_method":
				grandparent := parent.Parent()
				for grandparent != nil {
					if grandparent.Type() == "class" || grandparent.Type() == "module" {
						a.analyzeRubyNode(grandparent, content, ctx)
						break
					}
					grandparent = grandparent.Parent()
				}
				a.analyzeRubyNode(parent, content, ctx)
			}
		}

	case "block", "do_block":
		ctx.InFunction = true
		ctx.FunctionName = "<block>"
	}
}

func (a *ASTAnalyzer) extractNamespaceAndImports(root *sitter.Node, content []byte, ctx *ASTContext, language string) {
	if root == nil {
		return
	}

	for i := uint32(0); i < root.ChildCount(); i++ {
		child := root.Child(int(i))
		switch language {
		case "php":
			switch child.Type() {
			case "namespace_definition":
				if name := a.findChildByType(child, "namespace_name"); name != nil {
					ctx.Namespace = name.Content(content)
				}
			case "namespace_use_declaration":
				for j := uint32(0); j < child.ChildCount(); j++ {
					clause := child.Child(int(j))
					if clause.Type() == "namespace_use_clause" {
						if name := a.findChildByType(clause, "qualified_name"); name != nil {
							ctx.Imports = append(ctx.Imports, name.Content(content))
						}
					}
				}
			}

		case "go":
			switch child.Type() {
			case "package_clause":
				if name := a.findChildByType(child, "package_identifier"); name != nil {
					ctx.Namespace = name.Content(content)
				}
			case "import_declaration":
				for j := uint32(0); j < child.ChildCount(); j++ {
					spec := child.Child(int(j))
					if spec.Type() == "import_spec_list" {
						for k := uint32(0); k < spec.ChildCount(); k++ {
							importSpec := spec.Child(int(k))
							if importSpec.Type() == "import_spec" {
								if path := a.findChildByType(importSpec, "interpreted_string_literal"); path != nil {
									ctx.Imports = append(ctx.Imports, strings.Trim(path.Content(content), "\""))
								}
							}
						}
					} else if spec.Type() == "import_spec" {
						if path := a.findChildByType(spec, "interpreted_string_literal"); path != nil {
							ctx.Imports = append(ctx.Imports, strings.Trim(path.Content(content), "\""))
						}
					}
				}
			}

		case "typescript", "javascript", "typescriptreact", "javascriptreact":
			if child.Type() == "import_statement" {
				if source := a.findChildByType(child, "string"); source != nil {
					ctx.Imports = append(ctx.Imports, strings.Trim(source.Content(content), "'\""))
				}
			}

		case "python":
			switch child.Type() {
			case "import_statement":
				if name := a.findChildByType(child, "dotted_name"); name != nil {
					ctx.Imports = append(ctx.Imports, name.Content(content))
				}
			case "import_from_statement":
				if name := a.findChildByType(child, "dotted_name"); name != nil {
					ctx.Imports = append(ctx.Imports, name.Content(content))
				}
			}

		case "ruby":
			if child.Type() == "call" {
				if methodNode := a.findChildByType(child, "identifier"); methodNode != nil {
					methodName := methodNode.Content(content)
					if methodName == "require" || methodName == "require_relative" {
						if args := a.findChildByType(child, "argument_list"); args != nil {
							if str := a.findChildByType(args, "string"); str != nil {
								importPath := strings.Trim(str.Content(content), "'\"")
								ctx.Imports = append(ctx.Imports, importPath)
							}
						}
					}
				}
			}
		}
	}
}

func (a *ASTAnalyzer) extractFileClass(root *sitter.Node, content []byte, ctx *ASTContext, language string) {
	if root == nil {
		return
	}
	a.findClassInNode(root, content, ctx, language)
}

func (a *ASTAnalyzer) findClassInNode(node *sitter.Node, content []byte, ctx *ASTContext, language string) bool {
	if node == nil {
		return false
	}

	switch language {
	case "php":
		if node.Type() == "class_declaration" {
			if name := a.findChildByType(node, "name"); name != nil {
				ctx.ClassName = name.Content(content)
			}
			if extends := a.findChildByType(node, "base_clause"); extends != nil {
				if name := a.findChildByType(extends, "name"); name != nil {
					ctx.ParentClass = name.Content(content)
				}
			}
			return true
		}
	case "typescript", "javascript", "typescriptreact", "javascriptreact":
		if node.Type() == "class_declaration" || node.Type() == "class" {
			if name := a.findChildByType(node, "type_identifier"); name != nil {
				ctx.ClassName = name.Content(content)
			} else if name := a.findChildByType(node, "identifier"); name != nil {
				ctx.ClassName = name.Content(content)
			}
			if heritage := a.findChildByType(node, "class_heritage"); heritage != nil {
				if extends := a.findChildByType(heritage, "extends_clause"); extends != nil {
					if name := a.findChildByType(extends, "identifier"); name != nil {
						ctx.ParentClass = name.Content(content)
					} else if name := a.findChildByType(extends, "type_identifier"); name != nil {
						ctx.ParentClass = name.Content(content)
					}
				}
			}
			return true
		}
		if node.Type() == "export_statement" {
			if classDecl := a.findChildByType(node, "class_declaration"); classDecl != nil {
				return a.findClassInNode(classDecl, content, ctx, language)
			}
		}
	case "go":
		if node.Type() == "type_declaration" {
			for i := uint32(0); i < node.ChildCount(); i++ {
				child := node.Child(int(i))
				if child.Type() == "type_spec" {
					if name := a.findChildByType(child, "type_identifier"); name != nil {
						ctx.ClassName = name.Content(content)
						return true
					}
				}
			}
		}
	case "python":
		if node.Type() == "class_definition" {
			if name := a.findChildByType(node, "identifier"); name != nil {
				ctx.ClassName = name.Content(content)
			}
			if args := a.findChildByType(node, "argument_list"); args != nil {
				for i := uint32(0); i < args.ChildCount(); i++ {
					child := args.Child(int(i))
					if child.Type() == "identifier" {
						ctx.ParentClass = child.Content(content)
						break
					}
				}
			}
			return true
		}

	case "ruby":
		if node.Type() == "class" {
			if name := a.findChildByType(node, "constant"); name != nil {
				ctx.ClassName = name.Content(content)
			}
			if superclass := a.findChildByType(node, "superclass"); superclass != nil {
				if name := a.findChildByType(superclass, "constant"); name != nil {
					ctx.ParentClass = name.Content(content)
				}
			}
			return true
		}
		if node.Type() == "module" {
			if name := a.findChildByType(node, "constant"); name != nil {
				ctx.ClassName = name.Content(content)
			}
			return true
		}
	}

	for i := uint32(0); i < node.ChildCount(); i++ {
		if a.findClassInNode(node.Child(int(i)), content, ctx, language) {
			return true
		}
	}

	return false
}

func (a *ASTAnalyzer) determinePositionContext(ctx *ASTContext) PositionContext {
	if a.isInsideFunctionArguments(ctx) {
		return PositionContextFunctionArgument
	}

	if ctx.InMethod || ctx.InFunction {
		return PositionContextMethodBody
	}

	if ctx.InClass || ctx.InTrait {
		return PositionContextClassBody
	}

	if ctx.InInterface {
		return PositionContextClassBody
	}

	if len(ctx.Imports) > 0 && ctx.ClassName == "" {
		if a.isCodeStatement(ctx.NodeType, ctx.ParentType) {
			return PositionContextTopLevel
		}
		if ctx.CurrentPrefix != "" || ctx.AccessChain != "" {
			return PositionContextTopLevel
		}
		return PositionContextAfterImports
	}

	if a.isCodeStatement(ctx.NodeType, ctx.ParentType) {
		return PositionContextTopLevel
	}

	if ctx.CurrentPrefix != "" || ctx.AccessChain != "" {
		return PositionContextTopLevel
	}

	return PositionContextFileStart
}

func (a *ASTAnalyzer) isCodeStatement(nodeType, parentType string) bool {
	codeNodes := map[string]bool{
		"expression_statement": true, "echo_statement": true, "return_statement": true,
		"if_statement": true, "while_statement": true, "for_statement": true,
		"foreach_statement": true, "switch_statement": true, "try_statement": true,
		"throw_statement": true, "assignment_expression": true, "function_call_expression": true,
		"member_call_expression": true, "scoped_call_expression": true,
		"scoped_property_access_expression": true, "call_expression": true, "call": true,
		"member_expression": true, "variable_declaration": true, "variable_declarator": true,
		"const_declaration": true, "short_var_declaration": true, "go_statement": true,
		"defer_statement": true, "select_statement": true, "lexical_declaration": true,
		"variable_declaration_statement": true, "await_expression": true, "yield_expression": true,
		"with_statement": true, "assert_statement": true, "print_statement": true,
		"global_statement": true, "nonlocal_statement": true, "pass_statement": true,
		"break_statement": true, "continue_statement": true, "raise_statement": true,
		"name": true, "identifier": true, "scoped_identifier": true, "qualified_name": true,
		"argument_list": true, "string": true,
	}

	if codeNodes[nodeType] {
		return true
	}

	codeParents := map[string]bool{
		"expression_statement": true, "program": true, "source_file": true,
		"module": true, "script": true, "call": true, "lexical_declaration": true,
		"argument": true, "argument_list": true,
	}

	return codeParents[parentType] && nodeType != "program" && nodeType != "source_file" && nodeType != "ERROR"
}

func (a *ASTAnalyzer) isInsideFunctionArguments(ctx *ASTContext) bool {
	return ctx.NodeType == "argument" || ctx.ParentType == "argument_list" || ctx.ParentType == "arguments"
}

func (a *ASTAnalyzer) findChildByType(node *sitter.Node, childType string) *sitter.Node {
	for i := uint32(0); i < node.ChildCount(); i++ {
		child := node.Child(int(i))
		if child.Type() == childType {
			return child
		}
	}
	return nil
}

func (a *ASTAnalyzer) Close() {}

func (a *ASTAnalyzer) ExtractPrefixAtPosition(language string, content []byte, line, column int) (prefix string, inString bool, stringContent string, accessChain string, inComment bool, inImport bool, stringContextType string) {
	if isLineComment(content, line, column, language) {
		inComment = true
		return
	}

	tree, err := a.safeParser.Parse(language, content)
	if err != nil || tree == nil {
		prefix, accessChain = extractPrefixWithAccessChain(content, line, column, language)
		return
	}
	defer tree.Close()

	root := tree.RootNode()
	if root == nil {
		prefix, accessChain = extractPrefixWithAccessChain(content, line, column, language)
		return
	}

	col := column
	if col > 0 {
		col = col - 1
	}
	point := sitter.Point{Row: uint32(line - 1), Column: uint32(col)}

	node := root.NamedDescendantForPointRange(point, point)
	if node == nil {
		prefix, accessChain = extractPrefixWithAccessChain(content, line, column, language)
		return
	}

	nodeType := node.Type()
	nodeContent := string(content[node.StartByte():node.EndByte()])

	if isCommentNode(nodeType) {
		inComment = true
		return
	}

	if isImportNode(nodeType, language) || a.isInsideImport(node, language) {
		inImport = true
	}

	if isStringNode(nodeType, language) {
		nodeStart := node.StartPoint()
		nodeEnd := node.EndPoint()
		cursorInsideString := false
		if point.Row > nodeStart.Row || (point.Row == nodeStart.Row && point.Column > nodeStart.Column) {
			if point.Row < nodeEnd.Row || (point.Row == nodeEnd.Row && point.Column < nodeEnd.Column) {
				cursorInsideString = true
			}
		}
		if cursorInsideString {
			inString = true
			stringContent = extractStringContent(node, content, point)
			prefix = stringContent
			stringContextType = detectStringContextType(node, content, language)
			return
		}
	}

	if isIdentifierNode(nodeType, language) {
		nodeStart := node.StartPoint()
		if point.Row == nodeStart.Row {
			cursorOffset := int(point.Column) - int(nodeStart.Column)
			if cursorOffset > 0 && cursorOffset <= len(nodeContent) {
				prefix = nodeContent[:cursorOffset]
			} else if cursorOffset <= 0 {
				prefix = ""
			} else {
				prefix = nodeContent
			}
		} else {
			prefix = nodeContent
		}

		_, accessChain = extractAccessChainFromText(content, line, column, len(prefix))
		return
	}

	prefix, accessChain = extractPrefixWithAccessChain(content, line, column, language)
	return
}

func extractPrefixWithAccessChain(content []byte, line, column int, language string) (prefix string, accessChain string) {
	lines := strings.Split(string(content), "\n")
	if line <= 0 || line > len(lines) {
		return "", ""
	}

	lineContent := lines[line-1]
	if column <= 0 {
		return "", ""
	}

	endIdx := column - 1
	if endIdx > len(lineContent) {
		endIdx = len(lineContent)
	}
	beforeCursor := lineContent[:endIdx]

	prefix = ""
	prefixStart := len(beforeCursor)
	for i := len(beforeCursor) - 1; i >= 0; i-- {
		c := beforeCursor[i]
		if isIdentifierCharForLanguage(byte(c), language) {
			prefix = string(c) + prefix
			prefixStart = i
		} else {
			break
		}
	}

	textBeforePrefix := beforeCursor[:prefixStart]
	accessChain = extractTrailingAccessChain(textBeforePrefix)

	return prefix, accessChain
}

func extractAccessChainFromText(content []byte, line, column int, prefixLen int) (prefix string, accessChain string) {
	lines := strings.Split(string(content), "\n")
	if line <= 0 || line > len(lines) {
		return "", ""
	}

	lineContent := lines[line-1]
	if column <= 0 {
		return "", ""
	}

	endIdx := column - 1
	if endIdx > len(lineContent) {
		endIdx = len(lineContent)
	}
	beforeCursor := lineContent[:endIdx]

	prefixStart := len(beforeCursor) - prefixLen
	if prefixStart < 0 {
		prefixStart = 0
	}

	textBeforePrefix := beforeCursor[:prefixStart]
	accessChain = extractTrailingAccessChain(textBeforePrefix)

	return beforeCursor[prefixStart:], accessChain
}

func extractTrailingAccessChain(text string) string {
	text = strings.TrimRightFunc(text, unicode.IsSpace)
	if text == "" {
		return ""
	}
	if !(strings.HasSuffix(text, "::") || strings.HasSuffix(text, "->") || strings.HasSuffix(text, ".")) {
		return ""
	}

	start := len(text) - 1
	for start >= 0 {
		c := text[start]
		if !isAccessChainChar(c) {
			break
		}
		start--
	}

	chain := strings.TrimSpace(text[start+1:])
	if !(strings.HasSuffix(chain, "::") || strings.HasSuffix(chain, "->") || strings.HasSuffix(chain, ".")) {
		return ""
	}
	return chain
}

func isAccessChainChar(c byte) bool {
	return (c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') ||
		c == '_' || c == '$' || c == '\\' || c == '.' || c == ':' || c == '-' || c == '>' || c == ' '
}

func extractSimplePrefix(content []byte, line, column int, language string) string {
	prefix, _ := extractPrefixWithAccessChain(content, line, column, language)
	return prefix
}

func isIdentifierCharForLanguage(c byte, language string) bool {
	switch language {
	case "css", "scss", "sass", "less":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '#' || c == '.' || c == '@'
	case "blade":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '@'
	case "bash", "shell":
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '$'
	default:
		return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$'
	}
}

func isStringNode(nodeType, language string) bool {
	stringTypes := map[string]bool{
		"string": true, "string_content": true, "string_literal": true,
		"encapsed_string": true, "template_string": true, "raw_string_literal": true,
		"quoted_string": true, "heredoc": true,
		"interpreted_string_literal": true,
	}
	return stringTypes[nodeType]
}

func isCommentNode(nodeType string) bool {
	return nodeType == "comment" || nodeType == "line_comment" || nodeType == "block_comment"
}

func isLineComment(content []byte, line, column int, language string) bool {
	lines := strings.Split(string(content), "\n")
	if line <= 0 || line > len(lines) {
		return false
	}

	lineText := lines[line-1]
	col := column - 1
	if col < 0 {
		col = 0
	}
	if col > len(lineText) {
		col = len(lineText)
	}
	beforeCursor := strings.TrimSpace(lineText[:col])

	switch language {
	case "php", "go", "javascript", "typescript", "javascriptreact", "typescriptreact", "java", "csharp", "cpp", "c", "rust", "swift", "kotlin":
		if strings.HasPrefix(beforeCursor, "//") {
			return true
		}
		if strings.Contains(beforeCursor, "/*") && !strings.Contains(beforeCursor, "*/") {
			return true
		}
	case "python", "ruby", "bash", "shell":
		if strings.HasPrefix(beforeCursor, "#") {
			return true
		}
	case "html", "xml":
		if strings.Contains(beforeCursor, "<!--") && !strings.Contains(beforeCursor, "-->") {
			return true
		}
	}

	trimmed := strings.TrimSpace(lineText)
	switch language {
	case "php", "go", "javascript", "typescript", "javascriptreact", "typescriptreact", "java", "csharp", "cpp", "c", "rust", "swift", "kotlin":
		if strings.HasPrefix(trimmed, "//") {
			return true
		}
	case "python", "ruby", "bash", "shell":
		if strings.HasPrefix(trimmed, "#") {
			return true
		}
	}

	return false
}

func isImportNode(nodeType, language string) bool {
	switch language {
	case "go":
		return nodeType == "import_declaration" || nodeType == "import_spec" || nodeType == "import_spec_list"
	case "python":
		return nodeType == "import_statement" || nodeType == "import_from_statement"
	case "php":
		return nodeType == "use_declaration" || nodeType == "namespace_use_clause"
	case "javascript", "typescript", "javascriptreact", "typescriptreact":
		return nodeType == "import_statement" || nodeType == "import_clause"
	}
	return false
}

func (a *ASTAnalyzer) isInsideImport(node *sitter.Node, language string) bool {
	current := node
	for current != nil {
		if isImportNode(current.Type(), language) {
			return true
		}
		current = current.Parent()
	}
	return false
}

func detectStringContextType(node *sitter.Node, content []byte, language string) string {
	current := node.Parent()
	for current != nil {
		nodeType := current.Type()

		if isFunctionCallNode(nodeType, language) {
			funcName := extractFunctionNameFromCall(current, content, language)
			return mapFunctionToContextType(funcName, language)
		}

		current = current.Parent()
	}

	stringContent := string(content[node.StartByte():node.EndByte()])
	if strings.HasPrefix(stringContent, "./") || strings.HasPrefix(stringContent, "../") ||
		strings.HasPrefix(stringContent, "/") || strings.Contains(stringContent, "/") {
		return "path"
	}

	return ""
}

func isFunctionCallNode(nodeType, language string) bool {
	callTypes := map[string]bool{
		"function_call_expression": true, "call_expression": true,
		"method_call_expression": true, "scoped_call_expression": true,
		"member_call_expression": true,
	}
	return callTypes[nodeType]
}

func extractFunctionNameFromCall(node *sitter.Node, content []byte, language string) string {
	if node.ChildCount() == 0 {
		return ""
	}

	firstChild := node.Child(0)
	if firstChild == nil {
		return ""
	}

	childType := firstChild.Type()

	if childType == "name" || childType == "identifier" {
		return string(content[firstChild.StartByte():firstChild.EndByte()])
	}

	if childType == "scoped_call_expression" || childType == "member_access_expression" {
		for i := uint32(0); i < firstChild.ChildCount(); i++ {
			child := firstChild.Child(int(i))
			if child != nil && (child.Type() == "name" || child.Type() == "identifier") {
				return string(content[child.StartByte():child.EndByte()])
			}
		}
	}

	return string(content[firstChild.StartByte():firstChild.EndByte()])
}

func mapFunctionToContextType(funcName, language string) string {
	funcLower := strings.ToLower(funcName)

	routeFuncs := map[string]bool{"route": true, "url": true, "action": true, "redirect": true}
	viewFuncs := map[string]bool{"view": true, "render": true, "include": true, "extend": true, "extends": true}
	configFuncs := map[string]bool{"config": true, "env": true, "getenv": true}
	transFuncs := map[string]bool{"trans": true, "__": true, "t": true, "gettext": true, "_": true}

	if routeFuncs[funcLower] {
		return "route"
	}
	if viewFuncs[funcLower] {
		return "view"
	}
	if configFuncs[funcLower] {
		return "config"
	}
	if transFuncs[funcLower] {
		return "trans"
	}

	if language == "go" && funcLower == "import" {
		return "import"
	}
	if (language == "typescript" || language == "javascript" || language == "typescriptreact" || language == "javascriptreact") && (funcLower == "require" || funcLower == "import") {
		return "import"
	}

	return ""
}

func isIdentifierNode(nodeType, language string) bool {
	identTypes := map[string]bool{
		"name": true, "identifier": true, "property_name": true,
		"method_name": true, "class_name": true, "function_name": true,
		"variable_name": true, "variable": true, "simple_variable": true,
		"type_identifier": true, "field_identifier": true,
	}
	return identTypes[nodeType]
}

func isMemberAccessNode(nodeType, language string) bool {
	switch language {
	case "php":
		return nodeType == "member_access_expression" ||
			nodeType == "scoped_call_expression" ||
			nodeType == "scoped_property_access_expression"
	case "javascript", "typescript", "javascriptreact", "typescriptreact":
		return nodeType == "member_expression"
	case "python":
		return nodeType == "attribute"
	case "go":
		return nodeType == "selector_expression"
	}
	return false
}

func extractStringContent(node *sitter.Node, content []byte, cursorPoint sitter.Point) string {
	startByte := node.StartByte()
	cursorByte := uint32(0)

	lines := strings.Split(string(content), "\n")
	for i := uint32(0); i < cursorPoint.Row; i++ {
		if int(i) < len(lines) {
			cursorByte += uint32(len(lines[i])) + 1
		}
	}
	cursorByte += cursorPoint.Column

	nodeContent := string(content[startByte:node.EndByte()])
	if len(nodeContent) < 2 {
		return ""
	}

	offset := 1
	if strings.HasPrefix(nodeContent, "\"\"\"") || strings.HasPrefix(nodeContent, "'''") {
		offset = 3
	}

	contentStart := startByte + uint32(offset)
	if cursorByte > contentStart {
		extracted := string(content[contentStart:cursorByte])
		return extracted
	}

	return ""
}

func extractAccessChain(node *sitter.Node, content []byte, language string) string {
	return string(content[node.StartByte():node.EndByte()])
}
