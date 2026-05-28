type RuntimeEvent = {
  data: unknown;
};

type RuntimeCallback = (event: RuntimeEvent) => void;

type RuntimeWindow = typeof window & {
  go?: {
    main?: {
      App?: Record<string, (...args: unknown[]) => unknown>;
    };
  };
  runtime?: {
    EventsOnMultiple?: (
      eventName: string,
      callback: (payload: unknown) => void,
      maxCallbacks?: number,
    ) => (() => void) | string | void;
    EventsOff?: (eventName: string, ...additional: string[]) => void;
    EventsEmit?: (eventName: string, payload?: unknown) => void;
  };
};

const callIDToMethod = new Map<number, string>([
  [2889851111, "AIAcceptPlan"],
  [1259517548, "AIApplyPatchArtifact"],
  [3460816649, "AIApproveMnemonicEntryProposal"],
  [1854363573, "AICancelChatRun"],
  [4158315653, "AICancelProviderAuth"],
  [2039088801, "AIClearChatRuns"],
  [3157662221, "AIClearMnemonic"],
  [2030348068, "AIClearProviderSecret"],
  [975839874, "AIClearState"],
  [3573578537, "AICompactChatSession"],
  [1013189835, "AIDeleteChatSession"],
  [3906936029, "AIDeleteMnemonicEntry"],
  [814731225, "AIExecuteToolCall"],
  [3650690973, "AIGetApprovalPolicy"],
  [603794087, "AIGetChatRun"],
  [1983686025, "AIGetChatRunArtifact"],
  [1086241275, "AIGetChatRunEnvelope"],
  [1800928692, "AIGetConsentPolicy"],
  [2652800875, "AIGetContextContinuationPlan"],
  [2027484301, "AIGetContextPreview"],
  [2763431662, "AIGetEditorContinuation"],
  [1701132287, "AIGetEmbeddingStatus"],
  [502851175, "AIGetPredictionStatus"],
  [244439353, "AIGetProviderAuthSession"],
  [2779991082, "AIGetStatus"],
  [1030608623, "AIGetTerminalContinuation"],
  [3529150760, "AIInspectMnemonic"],
  [1854270319, "AIListAgentProfiles"],
  [3237612505, "AIListChatActions"],
  [3081304714, "AIListChatRunArtifacts"],
  [1998840304, "AIListChatRuns"],
  [214452907, "AIListContextCapsules"],
  [1718679039, "AIListContextProviders"],
  [1679514795, "AIListEgressRecords"],
  [2702940612, "AIListMnemonicEntries"],
  [1679118339, "AIListModelCapabilities"],
  [3049082509, "AIListPendingApprovals"],
  [1521013216, "AIListPromptWorkflows"],
  [3533759660, "AIListProviderRuntimes"],
  [271990918, "AIListProviders"],
  [560606393, "AIListToolAudit"],
  [202355223, "AIListTools"],
  [574574373, "AIPreviewBackgroundAgent"],
  [1140697846, "AIPreviewPatch"],
  [3550373077, "AIProbeModelCapability"],
  [4016510054, "AIProposeMnemonicEntry"],
  [3987994608, "AIRefreshLocalProviders"],
  [189525835, "AIRequestPlanRevision"],
  [29476953, "AIResizeAgentTerminal"],
  [4049094955, "AIRevokeApprovalPolicy"],
  [1889277476, "AIRevokeContextCapsule"],
  [4293294088, "AIRollbackPatchCheckpoint"],
  [1405553028, "AISaveApprovalPolicy"],
  [3889255099, "AISaveConsentPolicy"],
  [2691631747, "AISaveMnemonicEntry"],
  [3644810605, "AISavePredictionSettings"],
  [3522702413, "AISaveProviderSettings"],
  [1441185784, "AISearchMnemonic"],
  [1942126141, "AISetMnemonicEnabled"],
  [4220143164, "AIStartAgentAuthRun"],
  [2798365791, "AIStartChatRun"],
  [260566205, "AIStartLinkedReview"],
  [2003605964, "AIStartProviderOAuth"],
  [228515795, "AIStartProviderRuntime"],
  [2440051207, "AIStopProviderRuntime"],
  [2209184122, "AISubmitQuestionAnswer"],
  [2827541899, "AISuggestChatMentions"],
  [1869330485, "AITestProvider"],
  [2338728471, "AIUpdateMnemonicEntry"],
  [2821198052, "AIWriteAgentTerminalInput"],
  [2530714008, "AnalyzeModels"],
  [3193954122, "ApplyStagedAutoUpdate"],
  [2300795393, "CacheClear"],
  [2135757718, "CancelApplicationClose"],
  [2131516226, "CancelAutoUpdate"],
  [997180161, "CancelPrediction"],
  [2020379119, "CheckForAutoUpdate"],
  [871148448, "ClearApprovedDependencyActions"],
  [2560055152, "ClearCompiled"],
  [1040294288, "ClearPrivateUpdateToken"],
  [2251544015, "CloneRepository"],
  [1103140018, "CloseAllTerminals"],
  [3009242219, "CloseProject"],
  [2644038578, "CloseTerminal"],
  [3018436242, "ConfigCache"],
  [3112892232, "ConfirmApplicationClose"],
  [3111888563, "ConfirmPrediction"],
  [724601609, "CreateComponent"],
  [1404292690, "CreateController"],
  [1087386121, "CreateDirectory"],
  [3183386139, "CreateEnum"],
  [3252456582, "CreateEvent"],
  [3634170540, "CreateFactory"],
  [697686413, "CreateJob"],
  [3882498309, "CreateLivewire"],
  [3277600329, "CreateMail"],
  [2297098426, "CreateMigration"],
  [2896850663, "CreateModel"],
  [980233337, "CreateNewProject"],
  [2834322489, "CreateNotification"],
  [311290828, "CreatePolicy"],
  [20571138, "CreateResource"],
  [459891752, "CreateSeeder"],
  [235502754, "CreateTerminal"],
  [2729386138, "CreateTerminalForProject"],
  [2375229505, "DBSeed"],
  [2559271775, "DetectLanguage"],
  [63419757, "DetectLanguageFromFile"],
  [473229233, "DispatchCommand"],
  [658382952, "DownloadAutoUpdate"],
  [328600187, "DumpAutoload"],
  [1025973563, "ExecuteQuery"],
  [1025885202, "ExpandTag"],
  [2841662776, "FindEnv"],
  [1401680497, "FindFileByName"],
  [2905248636, "FormatCode"],
  [4096872364, "GetAllLSPServers"],
  [1283257190, "GetAutocompleteLanguageCapabilities"],
  [3794369294, "GetAutoUpdateStatus"],
  [3067698102, "GetBackgroundShellStatus"],
  [2280510586, "GetBuildInfo"],
  [1203248336, "GetCurrentProjectFramework"],
  [3371273781, "GetCurrentProjectID"],
  [2593824287, "GetCurrentProjectPath"],
  [3077915216, "GetCurrentProjectWindowSession"],
  [2525994829, "GetCurrentWorkDir"],
  [2362147149, "GetDependencyGraph"],
  [2830371102, "GetDependencyPolicyPlan"],
  [2210020427, "GetDependencySyncPlan"],
  [2497445234, "GetDevToolsStatus"],
  [3370448653, "GetDispatcherPinned"],
  [1437673616, "GetDispatcherRecent"],
  [3251177080, "GetDispatcherSuggestions"],
  [1922551346, "GetEditorCompletions"],
  [3416027546, "GetExecutionProfiles"],
  [2639483025, "GetGitBlame"],
  [1278498146, "GetGitBranch"],
  [1460332482, "GetGitBranches"],
  [2746986204, "GetGitCommitDiff"],
  [3611457121, "GetGitDiff"],
  [3015872912, "GetGitFileAtCommit"],
  [2722806557, "GetGitFileDiffBetweenCommits"],
  [3703725424, "GetGitLog"],
  [40344143, "GetGitShow"],
  [1919747364, "GetGitStatus"],
  [376927191, "GetInlineSuggestion"],
  [3906744297, "GetLanguageForFile"],
  [2721087573, "GetLaravelVersion"],
  [3503910979, "GetLastAutocompleteTrace"],
  [2696895551, "GetLSPBinaryPath"],
  [1917781466, "GetLSPForFile"],
  [3128036363, "GetLSPStatus"],
  [272325539, "GetMCPSettings"],
  [2180579094, "GetMiddlewareList"],
  [3845279568, "GetPackagedOSIntegrationStatus"],
  [931735635, "GetPluginCommands"],
  [926527160, "GetPrivateUpdateAuthStatus"],
  [3178930845, "GetProjectWindowSession"],
  [1425955691, "GetRecentProjects"],
  [2278641048, "GetRelatedFiles"],
  [4183578243, "GetRouteList"],
  [3845559944, "GetSearchIndexStatus"],
  [1382644170, "GetShellCapabilities"],
  [2571379691, "GetSupportedLanguages"],
  [3017116498, "GetTerminalHistory"],
  [2082398734, "GetTerminalPreview"],
  [2800269332, "GetWails3PackagedSmokeReport"],
  [493136510, "GetWindowLeaseStatus"],
  [478407520, "GoToDefinition"],
  [2912079387, "Greet"],
  [853170281, "ImportShellHistory"],
  [3426453654, "IndexLaravelAll"],
  [4060223649, "IndexLaravelConfig"],
  [3474920777, "IndexLaravelModels"],
  [1889572537, "IndexLaravelRoutes"],
  [2169319791, "IndexLaravelViews"],
  [3004685225, "InitDispatcherForProject"],
  [114260637, "InspectEditorFile"],
  [4029723443, "InspectProject"],
  [2130412873, "InspectProjectAccess"],
  [2006479156, "InstallAll"],
  [3885650062, "InstallBreeze"],
  [1632069174, "InstallFortify"],
  [498778204, "InstallJetstream"],
  [2728774898, "InstallLivewire"],
  [3999527395, "InstallLSPServer"],
  [2452996107, "InstallPackage"],
  [765696061, "IsLangDetectorLoaded"],
  [3205795312, "IsLaravelProject"],
  [3994420820, "IsLSPInstalling"],
  [238593744, "IsNativeFullscreen"],
  [2370967423, "ListApprovedDependencyActions"],
  [299341705, "ListInstalledPackages"],
  [1100446623, "ListTerminalSessions"],
  [693429932, "LSPApplyWorkspaceEdit"],
  [3094221445, "LSPGetCodeActions"],
  [2460201797, "LSPGetDiagnostics"],
  [1788738471, "LSPGoToDefinition"],
  [1356682693, "LSPHover"],
  [3440809205, "LSPPreloadProjectDiagnostics"],
  [1305918266, "LSPSignatureHelp"],
  [384045079, "Migrate"],
  [3039983393, "MigrateFresh"],
  [448313018, "MigrateRefresh"],
  [3735398646, "MigrateReset"],
  [4044463411, "MigrateRollback"],
  [3764159498, "MigrateSeed"],
  [287664385, "MigrateStatus"],
  [1959204684, "MoveProjectEntry"],
  [1567090827, "NotifyFileChanged"],
  [2376410677, "NotifyFileClosed"],
  [625133520, "NotifyFileOpened"],
  [4034583415, "OpenNativeContextMenu"],
  [2842778799, "OpenProject"],
  [3704102895, "OpenProjectWindow"],
  [1171889337, "OpenProjectWindowSession"],
  [1388141726, "ParseCommand"],
  [3339839442, "PinCommand"],
  [3063460412, "PositionNativeWindowControls"],
  [3501135860, "PredictCommand"],
  [2824179160, "PredictTerminalCommand"],
  [560416464, "PublishAssets"],
  [1975917236, "QueueWork"],
  [500956621, "ReadDirectory"],
  [1714943980, "ReadEditorBinaryFile"],
  [1734762579, "ReadEditorFilePreview"],
  [3196754789, "ReadEditorVisualFile"],
  [2878347744, "ReadFile"],
  [1241435419, "RebuildSearchIndex"],
  [1046187262, "RecordCommandExecution"],
  [2432176424, "RecordCompletionUsage"],
  [774283707, "RecordFileAccess"],
  [1513171292, "RecordGhostRejected"],
  [207276895, "RecordGhostShown"],
  [1790719449, "RecordTypingActivity"],
  [2092322392, "RefreshNativeWindowControls"],
  [3740764738, "RemovePackage"],
  [1128153851, "RenameProjectEntry"],
  [2378749434, "ResizeTerminal"],
  [3339885415, "RestartLSPServer"],
  [3073650660, "RevealProjectEntry"],
  [3088116603, "RouteCache"],
  [2676301637, "RunBackgroundShellAction"],
  [4132946231, "RunDependencyPolicySync"],
  [400581002, "RunGitCommand"],
  [3041314932, "RunMigrate"],
  [1943779455, "RunPackagedOSIntegrationAction"],
  [1655910089, "RunWindowLeaseAction"],
  [2796781428, "SaveMCPSettings"],
  [2166894452, "SavePrivateUpdateToken"],
  [2056674812, "ScheduleRun"],
  [874301014, "SearchClasses"],
  [2143790527, "SearchContent"],
  [993821393, "SearchFiles"],
  [2391516234, "SearchInProject"],
  [597251807, "SearchSymbols"],
  [2804908541, "SelectDirectory"],
  [3890198791, "SelectOpenTarget"],
  [2730424515, "SendTerminalText"],
  [3429320129, "Serve"],
  [2459870727, "SetApplicationIconAppearance"],
  [409774704, "SetCloseConfirmationEnabled"],
  [3411965839, "SetNativeWindowControlsVisible"],
  [207457449, "ShowPackageInfo"],
  [2745057471, "StorageLink"],
  [141691869, "SuggestCommand"],
  [2305528493, "SyncApplicationMenuShortcuts"],
  [666990439, "SyncApplicationMenuState"],
  [3713092259, "SyncProjectDependencies"],
  [3296933401, "Tinker"],
  [3730786860, "ToggleNativeFullscreen"],
  [1597950935, "TrashProjectEntry"],
  [2316907637, "UnpinCommand"],
  [3341221074, "UpdateAll"],
  [2217986349, "UpdatePackage"],
  [190856246, "UpdatePrediction"],
  [3496235921, "ValidateEnvironment"],
  [1742689507, "ViewCache"],
  [313870991, "WriteFile"],
  [3664655101, "WriteTerminal"],
]);

const localEventHandlers = new Map<string, Set<RuntimeCallback>>();

const getRuntimeWindow = (): RuntimeWindow | null =>
  typeof window === "undefined" ? null : (window as RuntimeWindow);

const defaultRuntimeResult = (
  methodName: string | undefined,
  ..._args: unknown[]
): unknown => {
  switch (methodName) {
    case "AIGetStatus":
      return {
        enabled: true,
        mnemonicEnabled: false,
        providers: [],
        settingsConfigured: false,
      };
    case "AIGetApprovalPolicy":
      return {
        mode: "ask_each_time",
        scope: {},
        allowedToolKinds: [],
        hardDenyCategories: [],
      };
    case "AIGetConsentPolicy":
      return {
        localProvidersAccepted: false,
        remoteProvidersAccepted: false,
        remoteByokProvidersAccepted: false,
        frontierProvidersAccepted: false,
        providerPolicies: [],
      };
    case "AISaveConsentPolicy":
      return {
        localProvidersAccepted: false,
        remoteProvidersAccepted: false,
        remoteByokProvidersAccepted: false,
        frontierProvidersAccepted: false,
        providerPolicies: [],
        ...((_args[0] as Record<string, unknown> | undefined) ?? {}),
      };
    case "AIGetPredictionStatus":
      return {
        enabled: false,
        settings: {
          enabled: false,
          mode: "off",
          idleMs: 600,
          minIntervalMs: 1200,
          maxPending: 1,
          maxOutputTokens: 96,
          maxPromptBytes: 12288,
          budget: {
            requestsPerMinute: 20,
            tokensPerMinute: 12000,
            tokensPerDay: 100000,
            requestsPerFilePerMinute: 8,
          },
        },
        providerReady: false,
        providerReason: "AI predictions are unavailable in the web-only shell.",
        budget: {
          requestsThisMinute: 0,
          tokensThisMinute: 0,
          tokensToday: 0,
          pendingRequests: 0,
        },
        consent: {
          localProvidersAccepted: false,
          remoteProvidersAccepted: false,
          remoteByokProvidersAccepted: false,
          frontierProvidersAccepted: false,
          externalAgentCliAccepted: false,
        },
      };
    case "AISavePredictionSettings":
      return {
        ...(defaultRuntimeResult("AIGetPredictionStatus") as Record<
          string,
          unknown
        >),
        settings: _args[0],
        enabled:
          Boolean((_args[0] as { enabled?: boolean } | undefined)?.enabled) &&
          false,
      };
    case "AIGetEditorContinuation":
      return {
        text: "",
        context: {
          id: "web-only-editor-continuation",
          capability: "line_prediction",
          snippets: [],
          contextItems: [],
          dataCategories: [],
          redaction: {},
          disclosure: {},
          disclosureSummary: {},
          approvalSummary: {},
          byteSize: 0,
          createdAt: new Date(0).toISOString(),
        },
      };
    case "AIGetEmbeddingStatus":
      return {
        status: "unknown",
        reason: "Embedding runtime is unavailable in the web-only shell.",
        providers: [],
        updatedAt: "",
      };
    case "AIGetContextPreview":
      return {
        id: "web-only-context-preview",
        projection: "preview",
        capability: "chat",
        snippets: [],
        contextItems: [],
        dataCategories: [],
        redaction: {},
        disclosure: {},
        disclosureSummary: {},
        approvalSummary: {},
        byteSize: 0,
        createdAt: new Date(0).toISOString(),
      };
    case "AIGetContextContinuationPlan":
      return {
        sessionId: _args[0] ?? "",
        included: [],
        stale: [],
        superseded: [],
        canCompact: false,
        canRevoke: false,
        disabledReason:
          "Context continuity is unavailable in the web-only shell.",
        policyReason:
          "Context continuity is unavailable in the web-only shell.",
        createdAt: new Date(0).toISOString(),
      };
    case "AICompactChatSession":
      throw new Error(
        "Context continuity compaction is unavailable in the web-only shell.",
      );
    case "AIRevokeContextCapsule":
      throw new Error(
        "Context continuity revocation is unavailable in the web-only shell.",
      );
    case "AIRefreshLocalProviders":
      return { providers: [], checkedAt: new Date(0).toISOString() };
    case "AISaveProviderSettings": {
      const settings =
        (_args[0] as
          | {
              id?: string;
              name?: string;
              kind?: string;
              endpoint?: string;
              model?: string;
              enabled?: boolean;
              manual?: boolean;
              secretRef?: string;
              secretValue?: string;
            }
          | undefined) ?? {};
      const remoteByok = settings.kind === "openai-compatible";
      return {
        id: settings.id ?? "",
        name: settings.name ?? settings.kind ?? "",
        kind: settings.kind ?? "",
        endpoint: settings.endpoint ?? "",
        endpointClass: remoteByok ? "remote_byok" : "loopback",
        local: !remoteByok,
        manual: Boolean(settings.manual),
        frontier: false,
        oauthSupported: false,
        requiresAuth: remoteByok,
        authConfigured: Boolean(settings.secretRef || settings.secretValue),
        capabilities: [
          "code_completion",
          "line_prediction",
          "terminal_prediction",
          "chat",
        ],
        models: [],
        defaultModel: settings.model ?? "",
        status: settings.enabled ? "needs_auth" : "disabled",
        reason: "Provider testing is unavailable in the web-only shell.",
      };
    }
    case "AIClearProviderSecret":
      return {
        id: _args[0] ?? "",
        kind: "openai-compatible",
        endpointClass: "remote_byok",
        local: false,
        manual: true,
        frontier: false,
        oauthSupported: false,
        requiresAuth: true,
        authConfigured: false,
        capabilities: [],
        models: [],
        status: "needs_auth",
      };
    case "AITestProvider":
      throw new Error("AI provider test is unavailable in the web-only shell.");
    case "AIStartProviderOAuth":
      return {
        id: "web-only-oauth-session",
        providerId: _args[0] ?? "",
        status: "waiting",
        authorizationUrl: "https://auth.example.test/oauth/authorize",
        startedAt: new Date(0).toISOString(),
        expiresAt: new Date(600000).toISOString(),
        authMode: "oauth",
      };
    case "AIGetProviderAuthSession":
      return {
        id: _args[0] ?? "web-only-oauth-session",
        providerId: "web-only-provider",
        status: "waiting",
        authorizationUrl: "https://auth.example.test/oauth/authorize",
        startedAt: new Date(0).toISOString(),
        expiresAt: new Date(600000).toISOString(),
        authMode: "oauth",
      };
    case "AICancelProviderAuth":
      return {
        id: _args[0] ?? "web-only-oauth-session",
        providerId: "web-only-provider",
        status: "canceled",
        authMode: "oauth",
      };
    case "AIListProviders":
    case "AIListProviderRuntimes":
    case "AIListChatRuns":
    case "AIListChatActions":
    case "AIListChatRunArtifacts":
    case "AIListContextCapsules":
    case "AIListContextProviders":
    case "AIListEgressRecords":
    case "AIListMnemonicEntries":
    case "AIListModelCapabilities":
    case "AIListPendingApprovals":
    case "AIListAgentProfiles":
    case "AIListPromptWorkflows":
    case "AIListTools":
    case "AIListToolAudit":
    case "AISearchMnemonic":
    case "AISuggestChatMentions":
      return [];
    case "AIProbeModelCapability":
      return {
        providerId:
          (_args[0] as { providerId?: string } | undefined)?.providerId ?? "",
        model: (_args[0] as { model?: string } | undefined)?.model ?? "",
        status: "failed",
        toolSupport: false,
        toolSupportKind: "none",
        structuredOutputSupport: false,
        patchGenerationSupport: false,
        latencyMs: 0,
        error: "AI model probe is unavailable in the web-only shell.",
        capabilitySource: "probe",
        checkedAt: new Date(0).toISOString(),
        expiresAt: "",
      };
    case "AIStartChatRun":
      throw new Error("AI chat run is unavailable in the web-only shell.");
    case "AIExecuteToolCall":
      throw new Error(
        "AI tool execution is unavailable in the web-only shell.",
      );
    case "AIAcceptPlan":
    case "AIApplyPatchArtifact":
    case "AIApproveMnemonicEntryProposal":
    case "AIPreviewPatch":
    case "AIRequestPlanRevision":
    case "AIRollbackPatchCheckpoint":
    case "AISaveMnemonicEntry":
    case "AIStartLinkedReview":
    case "AISubmitQuestionAnswer":
    case "AIUpdateMnemonicEntry":
      throw new Error("AI mutation is unavailable in the web-only shell.");
    default:
      return null;
  }
};

const callBridgeMethod = async (
  methodName: string | undefined,
  ...args: unknown[]
): Promise<unknown> => {
  if (!methodName) {
    return defaultRuntimeResult(methodName, ...args);
  }

  const bridge = getRuntimeWindow()?.go?.main?.App;
  const method = bridge?.[methodName];
  if (typeof method !== "function") {
    return defaultRuntimeResult(methodName, ...args);
  }

  const result = await method(...args);
  return result === null || result === undefined
    ? defaultRuntimeResult(methodName, ...args)
    : result;
};

const parseSource = (source: unknown): unknown => {
  if (typeof source !== "string") {
    return source;
  }
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
};

const identity = (value: unknown): unknown => value;

export const Call = {
  ByID: (id: number, ...args: unknown[]) => {
    const methodName = callIDToMethod.get(id);
    if (!methodName) {
      throw new Error(`Unmapped Wails runtime call ID ${id}.`);
    }
    return callBridgeMethod(methodName, ...args);
  },
  ByName: (methodName: string, ...args: unknown[]) =>
    callBridgeMethod(methodName.split(".").pop(), ...args),
};

export const CancellablePromise = Promise;

export const Create = {
  Any: identity,
  Array:
    (createItem: (value: unknown) => unknown = identity) =>
    (source: unknown): unknown[] => {
      const value = parseSource(source);
      return Array.isArray(value) ? value.map(createItem) : [];
    },
  Map:
    (
      _createKey: (value: unknown) => unknown = identity,
      createValue: (value: unknown) => unknown = identity,
    ) =>
    (source: unknown): Record<string, unknown> => {
      const value = parseSource(source);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          createValue(entry),
        ]),
      );
    },
  Nullable:
    (createValue: (value: unknown) => unknown = identity) =>
    (source: unknown): unknown =>
      source === null || source === undefined ? null : createValue(source),
};

export const Events = {
  On(eventName: string, callback: RuntimeCallback): () => void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsOnMultiple === "function") {
      const unsubscribe = runtime.EventsOnMultiple(
        eventName,
        (payload) => callback({ data: payload }),
        -1,
      );
      return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
    }

    const handlers = localEventHandlers.get(eventName) ?? new Set();
    handlers.add(callback);
    localEventHandlers.set(eventName, handlers);
    return () => handlers.delete(callback);
  },
  OnMultiple(
    eventName: string,
    callback: RuntimeCallback,
    maxCallbacks: number,
  ): () => void {
    let count = 0;
    const unsubscribe = Events.On(eventName, (event) => {
      if (maxCallbacks >= 0 && count >= maxCallbacks) {
        unsubscribe();
        return;
      }
      count += 1;
      callback(event);
      if (maxCallbacks >= 0 && count >= maxCallbacks) {
        unsubscribe();
      }
    });
    return unsubscribe;
  },
  Once(eventName: string, callback: RuntimeCallback): () => void {
    return Events.OnMultiple(eventName, callback, 1);
  },
  Off(eventName: string, ...additionalEventNames: string[]): void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsOff === "function") {
      runtime.EventsOff(eventName, ...additionalEventNames);
    }
    [eventName, ...additionalEventNames].forEach((name) =>
      localEventHandlers.delete(name),
    );
  },
  OffAll(): void {
    localEventHandlers.clear();
  },
  Emit(eventName: string, payload?: unknown): void {
    const runtime = getRuntimeWindow()?.runtime;
    if (typeof runtime?.EventsEmit === "function") {
      runtime.EventsEmit(eventName, payload);
      return;
    }

    const handlers = localEventHandlers.get(eventName) ?? new Set();
    handlers.forEach((handler) => handler({ data: payload }));
  },
};

export const Application = {
  Quit: async () => undefined,
};

export const Browser = {
  OpenURL: async () => undefined,
};

export const Clipboard = {
  Text: async () =>
    typeof window === "undefined"
      ? ""
      : ((window as unknown as { __copiedText?: string }).__copiedText ?? ""),
  SetText: async (text: string) => {
    if (typeof window !== "undefined") {
      (window as unknown as { __copiedText?: string }).__copiedText = text;
    }
  },
};

export const Window = {
  Fullscreen: async () => undefined,
  UnFullscreen: async () => undefined,
  IsFullscreen: async () => false,
  Minimise: async () => undefined,
  ToggleMaximise: async () => undefined,
  SetTitle: async () => undefined,
  Reload: async () => undefined,
};
