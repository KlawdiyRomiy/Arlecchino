import {
  Application,
  Browser,
  Clipboard,
  Events,
  Window,
} from "/wails/runtime.js";

const toLegacyData = (data: unknown): unknown[] => {
  if (Array.isArray(data)) {
    return data;
  }
  return [data];
};

export function EventsOn<TArgs extends unknown[]>(
  eventName: string,
  callback: (...data: TArgs) => void,
): () => void {
  return Events.On(eventName, (event) => {
    callback(...(toLegacyData(event.data) as TArgs));
  });
}

export function EventsOnMultiple<TArgs extends unknown[]>(
  eventName: string,
  callback: (...data: TArgs) => void,
  maxCallbacks: number,
): () => void {
  return Events.OnMultiple(eventName, (event) => {
    callback(...(toLegacyData(event.data) as TArgs));
  }, maxCallbacks);
}

export function EventsOnce<TArgs extends unknown[]>(
  eventName: string,
  callback: (...data: TArgs) => void,
): () => void {
  return Events.Once(eventName, (event) => {
    callback(...(toLegacyData(event.data) as TArgs));
  });
}

export function EventsOff(
  eventName: string,
  ...additionalEventNames: string[]
): void {
  Events.Off(eventName, ...additionalEventNames);
}

export function EventsOffAll(): void {
  Events.OffAll();
}

export function EventsEmit(eventName: string, ...data: unknown[]): void {
  void Events.Emit(eventName, data.length > 1 ? data : data[0]);
}

export function BrowserOpenURL(url: string): Promise<void> {
  return Browser.OpenURL(url);
}

export function ClipboardGetText(): Promise<string> {
  return Clipboard.Text();
}

export function ClipboardSetText(text: string): Promise<void> {
  return Clipboard.SetText(text);
}

export function Quit(): Promise<void> {
  return Application.Quit();
}

export function WindowFullscreen(): Promise<void> {
  return Window.Fullscreen();
}

export function WindowUnfullscreen(): Promise<void> {
  return Window.UnFullscreen();
}

export function WindowIsFullscreen(): Promise<boolean> {
  return Window.IsFullscreen();
}

export function WindowMinimise(): Promise<void> {
  return Window.Minimise();
}
