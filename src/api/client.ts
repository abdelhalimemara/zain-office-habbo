import {
  API,
  type ApproveRequest,
  type BoardConsultRequest,
  type BoardConsultResponse,
  type BoardResponse,
  type ConnectionsResponse,
  type CreateMandateRequest,
  type CreateMandateResponse,
  type HeadcountCatalogResponse,
  type HealthResponse,
  type HireRequest,
  type HireResponse,
  type RejectRequest,
  type ReopenRequest,
  type RosterResponse,
  type TaskDetailResponse,
} from "@shared/api";
import {
  MEETINGS_API,
  type FounderRemarkRequest,
  type MeetingResponse,
  type MeetingsResponse,
  type StartMeetingRequest,
} from "@shared/meetings";
import { LIVE_API, VOICE_API, type EndLiveRequest, type LiveSessionResponse, type SetVoiceRequest, type VoicesResponse } from "@shared/voice";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function errorMessage(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new ApiRequestError(await errorMessage(res), res.status);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export const api = {
  meetings: () => request<MeetingsResponse>(MEETINGS_API.list),
  meeting: (id: string) => request<MeetingResponse>(MEETINGS_API.one(id)),
  startMeeting: (input: StartMeetingRequest) => post<MeetingResponse>(MEETINGS_API.list, input),
  founderRemark: (id: string, input: FounderRemarkRequest) => post<MeetingResponse>(MEETINGS_API.remark(id), input),
  cancelMeeting: (id: string) => post<MeetingResponse>(MEETINGS_API.cancel(id), {}),
  voices: () => request<VoicesResponse>(VOICE_API.voices),
  setVoice: (profile: string, input: SetVoiceRequest) => put<unknown>(VOICE_API.voice(profile), input),
  liveSession: (id: string) => post<LiveSessionResponse>(LIVE_API.session(id), {}),
  endLive: (id: string, input: EndLiveRequest) => post<MeetingResponse>(LIVE_API.end(id), input),
  health: () => request<HealthResponse>(API.health),
  connections: () => request<ConnectionsResponse>(API.connections),
  board: () => request<BoardResponse>(API.board),
  task: (id: string) => request<TaskDetailResponse>(API.task(id)),
  addComment: (id: string, body: string) => post<unknown>(API.taskComments(id), { body }),
  createMandate: (input: CreateMandateRequest) => post<CreateMandateResponse>(API.mandates, input),
  approve: (id: string, input: ApproveRequest = {}) => post<unknown>(API.approve(id), input),
  reject: (id: string, input: RejectRequest) => post<unknown>(API.reject(id), input),
  reopen: (id: string, input: ReopenRequest) => post<unknown>(API.reopen(id), input),
  boardConsult: (input: BoardConsultRequest) => post<BoardConsultResponse>(API.boardConsult, input),
  roster: () => request<RosterResponse>(API.roster),
  hire: (input: HireRequest) => post<HireResponse>(API.hire, input),
  headcountCatalog: () => request<HeadcountCatalogResponse>(API.headcountCatalog),
};
