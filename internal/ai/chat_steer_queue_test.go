package ai

import (
	"context"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/ai/agents"
)

func TestNativeSteerCanceledBeforeConfirmationIsRejected(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}

	descriptor := service.descriptors["local-test"]
	provider := &blockingProvider{descriptor: descriptor, started: make(chan struct{})}
	service.providers[descriptor.ID] = provider
	run, err := service.StartChatRun(context.Background(), project.ID, AIChatRunRequest{
		SessionID: "steer-session",
		Action:    AIChatActionAsk,
		Prompt:    "Keep working until I steer you.",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}

	controller := &delayedNativeSteerController{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	service.registerLiveRunController(run.ID, controller)
	outcomes := make(chan struct {
		result AIChatSteerResult
		err    error
	}, 1)
	expectedRevision := service.currentRunRevision(run.ID)
	go func() {
		result, steerErr := service.SteerChatRun(context.Background(), project.ID, AISteerChatRunRequest{
			RunID:            run.ID,
			Message:          "Do not change public APIs.",
			ExpectedRevision: expectedRevision,
			IdempotencyKey:   "cancel-race-steer",
			Disposition:      "steer",
		})
		outcomes <- struct {
			result AIChatSteerResult
			err    error
		}{result: result, err: steerErr}
	}()
	select {
	case <-controller.started:
	case <-time.After(time.Second):
		t.Fatal("native controller did not receive steer")
	}

	if _, err := service.CancelChatRun(project.ID, run.ID); err != nil {
		t.Fatalf("CancelChatRun: %v", err)
	}
	close(controller.release)
	select {
	case outcome := <-outcomes:
		if outcome.err != nil {
			t.Fatalf("SteerChatRun: %v", outcome.err)
		}
		if outcome.result.State != AIChatSteerStateRejected {
			t.Fatalf("late native steer state = %q, want rejected", outcome.result.State)
		}
	case <-time.After(time.Second):
		t.Fatal("SteerChatRun did not return")
	}

	steers, err := project.ChatSteers.ListByRun(run.ID)
	if err != nil || len(steers) != 1 {
		t.Fatalf("steer ledger = %#v / %v", steers, err)
	}
	if steers[0].State != AIChatSteerStateRejected || steers[0].AppliedByRuntime {
		t.Fatalf("late native steer persisted as %#v", steers[0])
	}
	timeline, err := project.RunTimeline.ListByRun(run.ID, 0)
	if err != nil {
		t.Fatalf("ListByRun: %v", err)
	}
	for _, event := range timeline {
		if event.Type == "steer_applied" {
			t.Fatalf("canceled steer produced applied timeline event: %#v", timeline)
		}
	}
}

type delayedNativeSteerController struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (c *delayedNativeSteerController) Capabilities() agents.RuntimeCapabilities {
	return agents.RuntimeCapabilities{SupportsNativeSteer: true, SupportsInterrupt: true}
}

func (c *delayedNativeSteerController) Steer(context.Context, agents.SteerRequest) (agents.SteerResult, error) {
	c.once.Do(func() { close(c.started) })
	<-c.release
	return agents.SteerResult{State: "applied", Capability: "native", TurnID: "turn-2"}, nil
}

func (c *delayedNativeSteerController) Interrupt(context.Context) error {
	return nil
}

func (c *delayedNativeSteerController) Alive() bool {
	return true
}
