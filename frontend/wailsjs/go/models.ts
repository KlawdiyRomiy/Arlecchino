export namespace composer {
	
	export class InstallOptions {
	    Dev: boolean;
	    NoDev: boolean;
	    Optimize: boolean;
	    NoScripts: boolean;
	    Update: boolean;
	    IgnorePlatformReqs: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InstallOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Dev = source["Dev"];
	        this.NoDev = source["NoDev"];
	        this.Optimize = source["Optimize"];
	        this.NoScripts = source["NoScripts"];
	        this.Update = source["Update"];
	        this.IgnorePlatformReqs = source["IgnorePlatformReqs"];
	    }
	}
	export class RemoveOptions {
	    NoDev: boolean;
	    NoScripts: boolean;
	    Update: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RemoveOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.NoDev = source["NoDev"];
	        this.NoScripts = source["NoScripts"];
	        this.Update = source["Update"];
	    }
	}

}

export namespace indexer {
	
	export class DependencyEdge {
	    source: string;
	    target: string;
	    kind: string;
	    line: number;
	
	    static createFrom(source: any = {}) {
	        return new DependencyEdge(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = source["source"];
	        this.target = source["target"];
	        this.kind = source["kind"];
	        this.line = source["line"];
	    }
	}
	export class NodeSymbol {
	    name: string;
	    kind: string;
	    line: number;
	
	    static createFrom(source: any = {}) {
	        return new NodeSymbol(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.line = source["line"];
	    }
	}
	export class DependencyNode {
	    path: string;
	    symbols: NodeSymbol[];
	
	    static createFrom(source: any = {}) {
	        return new DependencyNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.symbols = this.convertValues(source["symbols"], NodeSymbol);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DependencyGraph {
	    nodes: DependencyNode[];
	    edges: DependencyEdge[];
	
	    static createFrom(source: any = {}) {
	        return new DependencyGraph(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], DependencyNode);
	        this.edges = this.convertValues(source["edges"], DependencyEdge);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class FileRelation {
	    path: string;
	    type: string;
	    lineNumber: number;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new FileRelation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.type = source["type"];
	        this.lineNumber = source["lineNumber"];
	        this.description = source["description"];
	    }
	}

}

export namespace lsp {
	
	export class ServerStatus {
	    Language: string;
	    Running: boolean;
	    ProcessAlive: boolean;
	    LastError: string;
	    Restarts: number;
	
	    static createFrom(source: any = {}) {
	        return new ServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Language = source["Language"];
	        this.Running = source["Running"];
	        this.ProcessAlive = source["ProcessAlive"];
	        this.LastError = source["LastError"];
	        this.Restarts = source["Restarts"];
	    }
	}

}

export namespace main {
	
	export class ClassResult {
	    name: string;
	    kind: string;
	    namespace: string;
	    filePath: string;
	    line: number;
	    pending: boolean;
	    extra?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ClassResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.namespace = source["namespace"];
	        this.filePath = source["filePath"];
	        this.line = source["line"];
	        this.pending = source["pending"];
	        this.extra = source["extra"];
	    }
	}
	export class CommandSuggestion {
	    text: string;
	    description: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new CommandSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.description = source["description"];
	        this.kind = source["kind"];
	    }
	}
	export class DefinitionResult {
	    path: string;
	    line: number;
	    context: string;
	    displayPath: string;
	
	    static createFrom(source: any = {}) {
	        return new DefinitionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.context = source["context"];
	        this.displayPath = source["displayPath"];
	    }
	}
	export class ResultItemJS {
	    id: string;
	    icon: string;
	    title: string;
	    subtitle: string;
	    action: string;
	    actionLabel: string;
	    filePath: string;
	    line: number;
	    score: number;
	
	    static createFrom(source: any = {}) {
	        return new ResultItemJS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.icon = source["icon"];
	        this.title = source["title"];
	        this.subtitle = source["subtitle"];
	        this.action = source["action"];
	        this.actionLabel = source["actionLabel"];
	        this.filePath = source["filePath"];
	        this.line = source["line"];
	        this.score = source["score"];
	    }
	}
	export class DispatcherResultJS {
	    success: boolean;
	    output: string;
	    error: string;
	    resultType: number;
	    items: ResultItemJS[];
	    preview: string;
	    shouldClose: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DispatcherResultJS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.resultType = source["resultType"];
	        this.items = this.convertValues(source["items"], ResultItemJS);
	        this.preview = source["preview"];
	        this.shouldClose = source["shouldClose"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TextEditJSON {
	    startLine: number;
	    startColumn: number;
	    endLine: number;
	    endColumn: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new TextEditJSON(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startLine = source["startLine"];
	        this.startColumn = source["startColumn"];
	        this.endLine = source["endLine"];
	        this.endColumn = source["endColumn"];
	        this.text = source["text"];
	    }
	}
	export class EditorCompletion {
	    label: string;
	    text: string;
	    detail: string;
	    documentation?: string;
	    typeInfo?: string;
	    kind: string;
	    source: string;
	    insertText: string;
	    isSnippet: boolean;
	    priority: number;
	    highlightPositions?: number[];
	    matchType?: string;
	    additionalTextEdits?: TextEditJSON[];
	
	    static createFrom(source: any = {}) {
	        return new EditorCompletion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.text = source["text"];
	        this.detail = source["detail"];
	        this.documentation = source["documentation"];
	        this.typeInfo = source["typeInfo"];
	        this.kind = source["kind"];
	        this.source = source["source"];
	        this.insertText = source["insertText"];
	        this.isSnippet = source["isSnippet"];
	        this.priority = source["priority"];
	        this.highlightPositions = source["highlightPositions"];
	        this.matchType = source["matchType"];
	        this.additionalTextEdits = this.convertValues(source["additionalTextEdits"], TextEditJSON);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EditorCompletionContext {
	    filePath: string;
	    language: string;
	    line: number;
	    column: number;
	    lineText: string;
	    textBefore: string;
	    textAfter: string;
	    fullText: string;
	    currentClass: string;
	    currentMethod: string;
	    imports: string[];
	    triggerChar: string;
	    requestId?: string;
	
	    static createFrom(source: any = {}) {
	        return new EditorCompletionContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.language = source["language"];
	        this.line = source["line"];
	        this.column = source["column"];
	        this.lineText = source["lineText"];
	        this.textBefore = source["textBefore"];
	        this.textAfter = source["textAfter"];
	        this.fullText = source["fullText"];
	        this.currentClass = source["currentClass"];
	        this.currentMethod = source["currentMethod"];
	        this.imports = source["imports"];
	        this.triggerChar = source["triggerChar"];
	        this.requestId = source["requestId"];
	    }
	}
	export class EditorCompletionResult {
	    primary?: EditorCompletion;
	    items: EditorCompletion[];
	    ghostText?: string;
	    ghostConfidence?: number;
	    showGhost: boolean;
	    requestId?: string;
	    stale?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditorCompletionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.primary = this.convertValues(source["primary"], EditorCompletion);
	        this.items = this.convertValues(source["items"], EditorCompletion);
	        this.ghostText = source["ghostText"];
	        this.ghostConfidence = source["ghostConfidence"];
	        this.showGhost = source["showGhost"];
	        this.requestId = source["requestId"];
	        this.stale = source["stale"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileEntry {
	    name: string;
	    path: string;
	    isDirectory: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDirectory = source["isDirectory"];
	    }
	}
	export class FlagDefJS {
	    name: string;
	    short: string;
	    description: string;
	    hasValue: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FlagDefJS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.short = source["short"];
	        this.description = source["description"];
	        this.hasValue = source["hasValue"];
	    }
	}
	export class GitCommitInfo {
	    hash: string;
	    shortHash: string;
	    author: string;
	    authorEmail: string;
	    date: string;
	    subject: string;
	    body: string;
	    parents: string;
	
	    static createFrom(source: any = {}) {
	        return new GitCommitInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.shortHash = source["shortHash"];
	        this.author = source["author"];
	        this.authorEmail = source["authorEmail"];
	        this.date = source["date"];
	        this.subject = source["subject"];
	        this.body = source["body"];
	        this.parents = source["parents"];
	    }
	}
	export class LSPWorkspaceEdit {
	    changes: Record<string, Array<LSPTextEdit>>;
	
	    static createFrom(source: any = {}) {
	        return new LSPWorkspaceEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.changes = this.convertValues(source["changes"], Array<LSPTextEdit>, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LSPCodeAction {
	    title: string;
	    kind?: string;
	    isPreferred?: boolean;
	    edit?: LSPWorkspaceEdit;
	    hasCommand: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LSPCodeAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.kind = source["kind"];
	        this.isPreferred = source["isPreferred"];
	        this.edit = this.convertValues(source["edit"], LSPWorkspaceEdit);
	        this.hasCommand = source["hasCommand"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LSPDefinitionResult {
	    path: string;
	    line: number;
	    char: number;
	
	    static createFrom(source: any = {}) {
	        return new LSPDefinitionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.char = source["char"];
	    }
	}
	export class LSPPosition {
	    line: number;
	    character: number;
	
	    static createFrom(source: any = {}) {
	        return new LSPPosition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.character = source["character"];
	    }
	}
	export class LSPRange {
	    start: LSPPosition;
	    end: LSPPosition;
	
	    static createFrom(source: any = {}) {
	        return new LSPRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = this.convertValues(source["start"], LSPPosition);
	        this.end = this.convertValues(source["end"], LSPPosition);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LSPDiagnostic {
	    range: LSPRange;
	    severity: number;
	    code?: string;
	    source?: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new LSPDiagnostic(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.range = this.convertValues(source["range"], LSPRange);
	        this.severity = source["severity"];
	        this.code = source["code"];
	        this.source = source["source"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class LSPServerInfo {
	    id: string;
	    name: string;
	    languages: string[];
	    extensions: string[];
	    installed: boolean;
	    version: string;
	    canInstall: boolean;
	    installCmd: string;
	
	    static createFrom(source: any = {}) {
	        return new LSPServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.languages = source["languages"];
	        this.extensions = source["extensions"];
	        this.installed = source["installed"];
	        this.version = source["version"];
	        this.canInstall = source["canInstall"];
	        this.installCmd = source["installCmd"];
	    }
	}
	export class LSPTextEdit {
	    range: LSPRange;
	    newText: string;
	
	    static createFrom(source: any = {}) {
	        return new LSPTextEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.range = this.convertValues(source["range"], LSPRange);
	        this.newText = source["newText"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LanguageInfoResult {
	    id: string;
	    name: string;
	    lspServerId: string;
	    lspInstalled: boolean;
	    canInstallLsp: boolean;
	    arleSupported: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LanguageInfoResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.lspServerId = source["lspServerId"];
	        this.lspInstalled = source["lspInstalled"];
	        this.canInstallLsp = source["canInstallLsp"];
	        this.arleSupported = source["arleSupported"];
	    }
	}
	export class LanguagePrediction {
	    language: string;
	    confidence: number;
	
	    static createFrom(source: any = {}) {
	        return new LanguagePrediction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.language = source["language"];
	        this.confidence = source["confidence"];
	    }
	}
	export class ParameterInfo {
	    label: string;
	    documentation: string;
	
	    static createFrom(source: any = {}) {
	        return new ParameterInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.documentation = source["documentation"];
	    }
	}
	export class PluginCommandDefJS {
	    plugin: string;
	    prefix: string;
	    name: string;
	    description: string;
	    outputKind: string;
	    pathPattern: string;
	    namespace: string;
	    flags: FlagDefJS[];
	
	    static createFrom(source: any = {}) {
	        return new PluginCommandDefJS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plugin = source["plugin"];
	        this.prefix = source["prefix"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.outputKind = source["outputKind"];
	        this.pathPattern = source["pathPattern"];
	        this.namespace = source["namespace"];
	        this.flags = this.convertValues(source["flags"], FlagDefJS);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SearchResult {
	    file: string;
	    line: number;
	    column: number;
	    preview: string;
	    matchStart: number;
	    matchEnd: number;
	    priority: number;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.line = source["line"];
	        this.column = source["column"];
	        this.preview = source["preview"];
	        this.matchStart = source["matchStart"];
	        this.matchEnd = source["matchEnd"];
	        this.priority = source["priority"];
	    }
	}
	export class SignatureInfo {
	    label: string;
	    documentation: string;
	    parameters: ParameterInfo[];
	
	    static createFrom(source: any = {}) {
	        return new SignatureInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.documentation = source["documentation"];
	        this.parameters = this.convertValues(source["parameters"], ParameterInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SignatureHelpResult {
	    signatures: SignatureInfo[];
	    activeSignature: number;
	    activeParameter: number;
	
	    static createFrom(source: any = {}) {
	        return new SignatureHelpResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.signatures = this.convertValues(source["signatures"], SignatureInfo);
	        this.activeSignature = source["activeSignature"];
	        this.activeParameter = source["activeParameter"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TerminalPredictionRequest {
	    input: string;
	    workDir: string;
	    projectID: string;
	
	    static createFrom(source: any = {}) {
	        return new TerminalPredictionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.workDir = source["workDir"];
	        this.projectID = source["projectID"];
	    }
	}
	export class TerminalPredictionResponse {
	    predictions: terminal.PredictionResult[];
	
	    static createFrom(source: any = {}) {
	        return new TerminalPredictionResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.predictions = this.convertValues(source["predictions"], terminal.PredictionResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TerminalPreviewJS {
	    output: string;
	    error: string;
	    isSafe: boolean;
	    exitCode: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TerminalPreviewJS(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.output = source["output"];
	        this.error = source["error"];
	        this.isSafe = source["isSafe"];
	        this.exitCode = source["exitCode"];
	        this.truncated = source["truncated"];
	    }
	}

}

export namespace plugins {
	
	export class ComponentOptions {
	    Force: boolean;
	    Plain: boolean;
	    Invokable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ComponentOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Plain = source["Plain"];
	        this.Invokable = source["Invokable"];
	    }
	}
	export class ControllerOptions {
	    Resource: boolean;
	    Api: boolean;
	    Plain: boolean;
	    Invokable: boolean;
	    Model: string;
	    Parent: string;
	    Singleton: boolean;
	    Requests: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ControllerOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Resource = source["Resource"];
	        this.Api = source["Api"];
	        this.Plain = source["Plain"];
	        this.Invokable = source["Invokable"];
	        this.Model = source["Model"];
	        this.Parent = source["Parent"];
	        this.Singleton = source["Singleton"];
	        this.Requests = source["Requests"];
	    }
	}
	export class EnumClassOptions {
	    Force: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnumClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	    }
	}
	export class EventClassOptions {
	    Force: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EventClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	    }
	}
	export class FactoryClassOptions {
	    Force: boolean;
	    Model: string;
	    Seeded: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FactoryClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Model = source["Model"];
	        this.Seeded = source["Seeded"];
	    }
	}
	export class JobOptions {
	    Sync: boolean;
	
	    static createFrom(source: any = {}) {
	        return new JobOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Sync = source["Sync"];
	    }
	}
	export class LivewireComponentOptions {
	    Force: boolean;
	    Inline: boolean;
	    Plain: boolean;
	    Invokable: boolean;
	    SkipViews: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LivewireComponentOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Inline = source["Inline"];
	        this.Plain = source["Plain"];
	        this.Invokable = source["Invokable"];
	        this.SkipViews = source["SkipViews"];
	    }
	}
	export class MailOptions {
	    Markdown: string;
	
	    static createFrom(source: any = {}) {
	        return new MailOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Markdown = source["Markdown"];
	    }
	}
	export class MigrationOptions {
	    Create: string;
	    Table: string;
	    Path: string;
	    Force: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MigrationOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Create = source["Create"];
	        this.Table = source["Table"];
	        this.Path = source["Path"];
	        this.Force = source["Force"];
	    }
	}
	export class ModelOptions {
	    All: boolean;
	    Controller: boolean;
	    Factory: boolean;
	    Invokable: boolean;
	    Migration: boolean;
	    Policy: boolean;
	    Resource: boolean;
	    Seeder: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ModelOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.All = source["All"];
	        this.Controller = source["Controller"];
	        this.Factory = source["Factory"];
	        this.Invokable = source["Invokable"];
	        this.Migration = source["Migration"];
	        this.Policy = source["Policy"];
	        this.Resource = source["Resource"];
	        this.Seeder = source["Seeder"];
	    }
	}
	export class NotificationOptions {
	    Force: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NotificationOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	    }
	}
	export class PolicyClassOptions {
	    Force: boolean;
	    Model: string;
	    Guard: string;
	    Resource: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PolicyClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Model = source["Model"];
	        this.Guard = source["Guard"];
	        this.Resource = source["Resource"];
	    }
	}
	export class ResourceClassOptions {
	    Collection: boolean;
	    Force: boolean;
	    Invokable: boolean;
	    Model: string;
	
	    static createFrom(source: any = {}) {
	        return new ResourceClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Collection = source["Collection"];
	        this.Force = source["Force"];
	        this.Invokable = source["Invokable"];
	        this.Model = source["Model"];
	    }
	}
	export class SeederClassOptions {
	    Force: boolean;
	    Class: string;
	
	    static createFrom(source: any = {}) {
	        return new SeederClassOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Class = source["Class"];
	    }
	}

}

export namespace project {
	
	export class Project {
	    id: number;
	    name: string;
	    path: string;
	    framework: string;
	    version: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    last_opened: any;
	    is_favorite: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.framework = source["framework"];
	        this.version = source["version"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.last_opened = this.convertValues(source["last_opened"], null);
	        this.is_favorite = source["is_favorite"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace system {
	
	export class CacheOptions {
	    ExcludeGroups: string[];
	    IncludeGroups: string[];
	
	    static createFrom(source: any = {}) {
	        return new CacheOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ExcludeGroups = source["ExcludeGroups"];
	        this.IncludeGroups = source["IncludeGroups"];
	    }
	}
	export class MigrateOptions {
	    Force: boolean;
	    Step: number;
	    Path: string;
	    Realpath: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MigrateOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Force = source["Force"];
	        this.Step = source["Step"];
	        this.Path = source["Path"];
	        this.Realpath = source["Realpath"];
	    }
	}
	export class MigrateRefreshOptions {
	    Seed: boolean;
	    Step: number;
	    Path: string;
	    Realpath: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MigrateRefreshOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Seed = source["Seed"];
	        this.Step = source["Step"];
	        this.Path = source["Path"];
	        this.Realpath = source["Realpath"];
	    }
	}
	export class MigrateResetOptions {
	    Path: string;
	    Realpath: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MigrateResetOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Path = source["Path"];
	        this.Realpath = source["Realpath"];
	    }
	}
	export class MigrateRollbackOptions {
	    Step: number;
	    Paths: string[];
	    Realpath: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MigrateRollbackOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Step = source["Step"];
	        this.Paths = source["Paths"];
	        this.Realpath = source["Realpath"];
	    }
	}
	export class ServeOptions {
	    Host: string;
	    Port: string;
	    Env: string;
	    ForceHttps: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ServeOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Host = source["Host"];
	        this.Port = source["Port"];
	        this.Env = source["Env"];
	        this.ForceHttps = source["ForceHttps"];
	    }
	}

}

export namespace terminal {
	
	export class PredictionResult {
	    Text: string;
	    Completion: string;
	    Output: string;
	    Source: string;
	    Confidence: number;
	
	    static createFrom(source: any = {}) {
	        return new PredictionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Text = source["Text"];
	        this.Completion = source["Completion"];
	        this.Output = source["Output"];
	        this.Source = source["Source"];
	        this.Confidence = source["Confidence"];
	    }
	}

}

export namespace welcome {
	
	export class ToolStatus {
	    name: string;
	    available: boolean;
	    version: string;
	    installCmd: string;
	
	    static createFrom(source: any = {}) {
	        return new ToolStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.available = source["available"];
	        this.version = source["version"];
	        this.installCmd = source["installCmd"];
	    }
	}

}

