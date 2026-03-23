package brain

func NewStubProviderWithBuiltins() *StubProvider {
	p := NewStubProvider()
	p.loadBuiltInStubs()
	return p
}

func (p *StubProvider) loadBuiltInStubs() {
	for _, spec := range builtInPackageStubs() {
		p.UpsertPackageStub(spec.language, spec.packageName, &spec.stub)
	}
}

type builtInStubSpec struct {
	language    string
	packageName string
	stub        PackageStub
}

func builtInPackageStubs() []builtInStubSpec {
	return []builtInStubSpec{
		{language: "javascript", packageName: "axios", stub: PackageStub{Aliases: []string{"axios"}, Exports: map[string]StubExport{
			"create":       {Signature: "create(config?: AxiosRequestConfig): AxiosInstance", Kind: "function"},
			"get":          {Signature: "get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse>", Kind: "function"},
			"post":         {Signature: "post(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse>", Kind: "function"},
			"interceptors": {Signature: "interceptors", Kind: "property"},
		}}},
		{language: "typescript", packageName: "axios", stub: PackageStub{Aliases: []string{"axios"}, Exports: map[string]StubExport{
			"create":       {Signature: "create(config?: AxiosRequestConfig): AxiosInstance", Kind: "function"},
			"get":          {Signature: "get(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse>", Kind: "function"},
			"post":         {Signature: "post(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse>", Kind: "function"},
			"interceptors": {Signature: "interceptors", Kind: "property"},
		}}},
		{language: "javascript", packageName: "console", stub: PackageStub{Aliases: []string{"console"}, Exports: map[string]StubExport{
			"log":   {Signature: "log(message?: any): void", Kind: "method"},
			"error": {Signature: "error(message?: any): void", Kind: "method"},
			"warn":  {Signature: "warn(message?: any): void", Kind: "method"},
			"info":  {Signature: "info(message?: any): void", Kind: "method"},
		}}},
		{language: "javascript", packageName: "Math", stub: PackageStub{Aliases: []string{"Math"}, Exports: map[string]StubExport{
			"max":   {Signature: "max(...values: number[]): number", Kind: "method"},
			"min":   {Signature: "min(...values: number[]): number", Kind: "method"},
			"round": {Signature: "round(value: number): number", Kind: "method"},
			"floor": {Signature: "floor(value: number): number", Kind: "method"},
		}}},
		{language: "typescript", packageName: "zod", stub: PackageStub{Aliases: []string{"z"}, Exports: map[string]StubExport{
			"string": {Signature: "string(): ZodString", Kind: "function"},
			"number": {Signature: "number(): ZodNumber", Kind: "function"},
			"object": {Signature: "object(shape: any): ZodObject", Kind: "function"},
			"array":  {Signature: "array(item: any): ZodArray", Kind: "function"},
		}}},
		{language: "javascript", packageName: "lodash", stub: PackageStub{Aliases: []string{"_"}, Exports: map[string]StubExport{
			"map":      {Signature: "map(collection, iteratee)", Kind: "function"},
			"filter":   {Signature: "filter(collection, predicate)", Kind: "function"},
			"reduce":   {Signature: "reduce(collection, iteratee, accumulator)", Kind: "function"},
			"debounce": {Signature: "debounce(func, wait)", Kind: "function"},
		}}},
		{language: "python", packageName: "os.path", stub: PackageStub{Aliases: []string{"os.path"}, Exports: map[string]StubExport{
			"join":     {Signature: "join(path, *paths)", Kind: "function"},
			"basename": {Signature: "basename(path)", Kind: "function"},
			"dirname":  {Signature: "dirname(path)", Kind: "function"},
			"exists":   {Signature: "exists(path)", Kind: "function"},
		}}},
		{language: "python", packageName: "requests", stub: PackageStub{Aliases: []string{"requests"}, Exports: map[string]StubExport{
			"get":     {Signature: "get(url, **kwargs)", Kind: "function"},
			"post":    {Signature: "post(url, data=None, json=None, **kwargs)", Kind: "function"},
			"put":     {Signature: "put(url, data=None, **kwargs)", Kind: "function"},
			"delete":  {Signature: "delete(url, **kwargs)", Kind: "function"},
			"Session": {Signature: "class Session", Kind: "class"},
		}}},
		{language: "python", packageName: "json", stub: PackageStub{Aliases: []string{"json"}, Exports: map[string]StubExport{
			"dump":  {Signature: "dump(obj, fp, **kwargs)", Kind: "function"},
			"dumps": {Signature: "dumps(obj, **kwargs)", Kind: "function"},
			"load":  {Signature: "load(fp, **kwargs)", Kind: "function"},
			"loads": {Signature: "loads(s, **kwargs)", Kind: "function"},
		}}},
		{language: "php", packageName: "Carbon\\Carbon", stub: PackageStub{Aliases: []string{"Carbon"}, Exports: map[string]StubExport{
			"now":    {Signature: "public static function now(): Carbon", Kind: "method"},
			"parse":  {Signature: "public static function parse(string $time): Carbon", Kind: "method"},
			"create": {Signature: "public static function create(...$args): Carbon", Kind: "method"},
		}}},
		{language: "go", packageName: "fmt", stub: PackageStub{Aliases: []string{"fmt"}, Exports: map[string]StubExport{
			"Println":   {Signature: "func Println(a ...any) (n int, err error)", Kind: "function"},
			"Printf":    {Signature: "func Printf(format string, a ...any) (n int, err error)", Kind: "function"},
			"Sprintf":   {Signature: "func Sprintf(format string, a ...any) string", Kind: "function"},
			"Formatter": {Signature: "type Formatter interface", Kind: "interface"},
		}}},
		{language: "ruby", packageName: "File", stub: PackageStub{Aliases: []string{"File"}, Exports: map[string]StubExport{
			"read":  {Signature: "read(path)", Kind: "method"},
			"open":  {Signature: "open(path, mode='r')", Kind: "method"},
			"write": {Signature: "write(path, string)", Kind: "method"},
		}}},
		{language: "ruby", packageName: "json", stub: PackageStub{Aliases: []string{"JSON"}, Exports: map[string]StubExport{
			"parse":    {Signature: "parse(source, opts = {})", Kind: "method"},
			"generate": {Signature: "generate(obj, opts = {})", Kind: "method"},
			"dump":     {Signature: "dump(obj, io = nil, limit = nil)", Kind: "method"},
		}}},
		{language: "ruby", packageName: "Faraday", stub: PackageStub{Aliases: []string{"Faraday"}, Exports: map[string]StubExport{
			"new":  {Signature: "new(url = nil, options = nil)", Kind: "method"},
			"get":  {Signature: "get(url = nil, params = nil)", Kind: "method"},
			"post": {Signature: "post(url = nil, body = nil)", Kind: "method"},
		}}},
		{language: "rust", packageName: "String", stub: PackageStub{Aliases: []string{"String"}, Exports: map[string]StubExport{
			"new":           {Signature: "fn new() -> String", Kind: "method"},
			"from":          {Signature: "fn from<T>(value: T) -> String", Kind: "method"},
			"with_capacity": {Signature: "fn with_capacity(capacity: usize) -> String", Kind: "method"},
		}}},
		{language: "rust", packageName: "serde", stub: PackageStub{Aliases: []string{"serde"}, Exports: map[string]StubExport{
			"Serialize":   {Signature: "trait Serialize", Kind: "type"},
			"Deserialize": {Signature: "trait Deserialize<'de>", Kind: "type"},
			"json":        {Signature: "mod json", Kind: "module"},
		}}},
		{language: "java", packageName: "java.lang.System.out", stub: PackageStub{Aliases: []string{"System.out"}, Exports: map[string]StubExport{
			"print":   {Signature: "print(String value)", Kind: "method"},
			"println": {Signature: "println(String value)", Kind: "method"},
			"printf":  {Signature: "printf(String format, Object... args)", Kind: "method"},
		}}},
		{language: "java", packageName: "com.fasterxml.jackson.databind.ObjectMapper", stub: PackageStub{Aliases: []string{"ObjectMapper"}, Exports: map[string]StubExport{
			"readValue":          {Signature: "readValue(String content, Class<T> valueType)", Kind: "method"},
			"writeValueAsString": {Signature: "writeValueAsString(Object value)", Kind: "method"},
		}}},
		{language: "csharp", packageName: "Newtonsoft.Json.JsonConvert", stub: PackageStub{Aliases: []string{"JsonConvert"}, Exports: map[string]StubExport{
			"SerializeObject":   {Signature: "SerializeObject(object value)", Kind: "method"},
			"DeserializeObject": {Signature: "DeserializeObject<T>(string value)", Kind: "method"},
		}}},
		{language: "swift", packageName: "Alamofire", stub: PackageStub{Aliases: []string{"AF"}, Exports: map[string]StubExport{
			"request":  {Signature: "request(_ convertible: URLConvertible)", Kind: "method"},
			"upload":   {Signature: "upload(_ data: Data, to: URLConvertible)", Kind: "method"},
			"download": {Signature: "download(_ convertible: URLConvertible)", Kind: "method"},
		}}},
		{language: "kotlin", packageName: "io.ktor.client", stub: PackageStub{Aliases: []string{"Ktor"}, Exports: map[string]StubExport{
			"get":    {Signature: "get(url: String)", Kind: "method"},
			"post":   {Signature: "post(url: String)", Kind: "method"},
			"put":    {Signature: "put(url: String)", Kind: "method"},
			"delete": {Signature: "delete(url: String)", Kind: "method"},
		}}},
		{language: "scala", packageName: "akka.actor.ActorSystem", stub: PackageStub{Aliases: []string{"ActorSystem"}, Exports: map[string]StubExport{
			"apply":     {Signature: "apply(name: String): ActorSystem", Kind: "method"},
			"create":    {Signature: "create(name: String): ActorSystem", Kind: "method"},
			"terminate": {Signature: "terminate(): Future[Terminated]", Kind: "method"},
		}}},
		{language: "dart", packageName: "dio", stub: PackageStub{Aliases: []string{"Dio"}, Exports: map[string]StubExport{
			"get":    {Signature: "get(String path)", Kind: "method"},
			"post":   {Signature: "post(String path)", Kind: "method"},
			"put":    {Signature: "put(String path)", Kind: "method"},
			"delete": {Signature: "delete(String path)", Kind: "method"},
		}}},
		{language: "cpp", packageName: "std::string", stub: PackageStub{Aliases: []string{"std::string"}, Exports: map[string]StubExport{
			"size":   {Signature: "size() const", Kind: "method"},
			"empty":  {Signature: "empty() const", Kind: "method"},
			"substr": {Signature: "substr(size_type pos, size_type count = npos) const", Kind: "method"},
		}}},
		{language: "cpp", packageName: "std::vector", stub: PackageStub{Aliases: []string{"std::vector"}, Exports: map[string]StubExport{
			"push_back": {Signature: "push_back(const T& value)", Kind: "method"},
			"size":      {Signature: "size() const", Kind: "method"},
			"clear":     {Signature: "clear()", Kind: "method"},
		}}},
		{language: "cpp", packageName: "std::map", stub: PackageStub{Aliases: []string{"std::map"}, Exports: map[string]StubExport{
			"find":   {Signature: "find(const Key& key)", Kind: "method"},
			"insert": {Signature: "insert(const value_type& value)", Kind: "method"},
			"erase":  {Signature: "erase(const Key& key)", Kind: "method"},
		}}},
		{language: "c", packageName: "malloc", stub: PackageStub{Aliases: []string{"malloc"}, Exports: map[string]StubExport{
			"malloc": {Signature: "void *malloc(size_t size)", Kind: "function"},
		}}},
		{language: "c", packageName: "printf", stub: PackageStub{Aliases: []string{"printf"}, Exports: map[string]StubExport{
			"printf": {Signature: "int printf(const char *format, ...)", Kind: "function"},
		}}},
	}
}
