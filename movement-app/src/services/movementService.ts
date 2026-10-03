import { supabase } from '../lib/supabase';
import {
  AcceptedAlignment,
  MovementFundingStatus,
  FinancialProposalOffererConsent,
  FinancialProposalRequesterMaterialization,
  AcceptFinancialProposalAsOffererInput,
  AlignmentStatusSummary,
  CreatedMovementOffer,
  CreateMovementOfferInput,
  MaskedMovementNeed,
  MaskedMovementOffer,
  PostActivationPerson,
  PostActivationVehicle,
  SafeFinancialProposal,
} from '../types/movement';

function fundingUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
}
function parseMovementFunding(data: unknown, agreementId: string, version?: number): MovementFundingStatus {
  if (!Array.isArray(data) || data.length !== 1) throw new Error();
  const r: unknown = data[0];
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error();
  const x = r as Record<string, unknown>;
  const keys = ['agreement_version','alignment_id','currency','financial_agreement_id','fully_held_at','funding_status','held_minor','required_minor'];
  const actual = Object.keys(x).sort();
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (actual.length !== keys.length || actual.some((k,i) => k !== keys[i])
    || !fundingUuid(x.financial_agreement_id) || x.financial_agreement_id.toLowerCase() !== agreementId.toLowerCase()
    || !fundingUuid(x.alignment_id) || !integer(x.agreement_version) || x.agreement_version < 1 || x.agreement_version > 2147483647
    || (version !== undefined && x.agreement_version !== version)
    || x.currency !== 'NGN' || !integer(x.required_minor) || !integer(x.held_minor)
    || (x.funding_status !== 'held' && x.funding_status !== 'not_held')) throw new Error();
  if (x.funding_status === 'not_held') {
    if (x.held_minor !== 0 || x.fully_held_at !== null) throw new Error();
  } else {
    if (x.held_minor !== x.required_minor || typeof x.fully_held_at !== 'string' || !Number.isFinite(Date.parse(x.fully_held_at))) throw new Error();
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(x.fully_held_at);
    if (!m) throw new Error();
    const y=Number(m[1]), month=Number(m[2]), day=Number(m[3]);
    const leap=y%4===0 && (y%100!==0 || y%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if (y<1 || month<1 || month>12 || day<1 || day>days[month-1] || Number(m[4])>23 || Number(m[5])>59 || Number(m[6])>59
      || (m[7] && (Number(m[7])>23 || Number(m[8])>59))) throw new Error();
  }
  return { financialAgreementId:x.financial_agreement_id, agreementVersion:x.agreement_version, alignmentId:x.alignment_id,
    fundingStatus:x.funding_status, requiredMinor:x.required_minor, heldMinor:x.held_minor, currency:'NGN', fullyHeldAt:x.fully_held_at as string|null };
}
export async function holdMyMovementFunds(financialAgreementId: string, expectedAgreementVersion: number): Promise<MovementFundingStatus> {
  try {
    if (!fundingUuid(financialAgreementId) || !Number.isInteger(expectedAgreementVersion) || expectedAgreementVersion<1 || expectedAgreementVersion>2147483647) throw new Error();
    const {data,error}=await supabase.rpc('hold_my_movement_funds',{p_financial_agreement_id:financialAgreementId,p_expected_agreement_version:expectedAgreementVersion});
    if (error) throw new Error();
    const result=parseMovementFunding(data,financialAgreementId,expectedAgreementVersion);
    if (result.fundingStatus !== 'held') throw new Error();
    return result;
  } catch { throw new Error('movement_funding_unavailable'); }
}
export async function getMyMovementFundingStatus(financialAgreementId: string): Promise<MovementFundingStatus> {
  try {
    if (!fundingUuid(financialAgreementId)) throw new Error();
    const {data,error}=await supabase.rpc('get_my_movement_funding_status',{p_financial_agreement_id:financialAgreementId});
    if (error) throw new Error();
    return parseMovementFunding(data,financialAgreementId);
  } catch { throw new Error('movement_funding_unavailable'); }
}

export async function acceptMyFinancialProposalAsRequester(
  financialProposalId: string, expectedProposalVersion: number,
): Promise<FinancialProposalRequesterMaterialization> {
  const uuid = (v: unknown): v is string => typeof v === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const timestamp = (v: unknown): v is string => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(v);
    if (!m) return false;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6]) < 60
      && (!m[7] || (Number(m[7]) < 24 && Number(m[8]) < 60));
  };
  const instant = (v: string): bigint => {
    const fraction = /\.(\d+)/.exec(v)?.[1] ?? '';
    return BigInt(Date.parse(v.replace(/\.\d+/, ''))) * 1000000n
      + BigInt(fraction.padEnd(9, '0'));
  };
  try {
    if (!uuid(financialProposalId) || !Number.isInteger(expectedProposalVersion)
      || expectedProposalVersion < 1 || expectedProposalVersion > 2147483647) throw new Error();
    const { data, error } = await supabase.rpc('accept_my_financial_proposal_as_requester', {
      p_financial_proposal_id: financialProposalId, p_expected_proposal_version: expectedProposalVersion,
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    const value: unknown = data[0];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const r = value as Record<string, unknown>;
    const keys = ['alignment_id','alignment_status','financial_agreement_id','materialized_at',
      'movement_offer_id','proposal_id','proposal_status','proposal_version','requester_accepted_at'];
    const actual = Object.keys(r).sort();
    if (actual.length !== keys.length || actual.some((key, i) => key !== keys[i])
      || !uuid(r.proposal_id) || r.proposal_id.toLowerCase() !== financialProposalId.toLowerCase()
      || r.proposal_version !== expectedProposalVersion || r.proposal_status !== 'current'
      || !uuid(r.movement_offer_id) || !uuid(r.alignment_id) || !uuid(r.financial_agreement_id)
      || (r.alignment_status !== 'awaiting_activation_payment' && r.alignment_status !== 'activated'
        && r.alignment_status !== 'in_progress' && r.alignment_status !== 'completed' && r.alignment_status !== 'cancelled')
      || !timestamp(r.requester_accepted_at) || !timestamp(r.materialized_at)
      || instant(r.materialized_at) < instant(r.requester_accepted_at)) throw new Error();
    return { proposalId: r.proposal_id, proposalVersion: expectedProposalVersion, proposalStatus: 'current',
      movementOfferId: r.movement_offer_id, alignmentId: r.alignment_id, alignmentStatus: r.alignment_status,
      financialAgreementId: r.financial_agreement_id, requesterAcceptedAt: r.requester_accepted_at, materializedAt: r.materialized_at };
  } catch {
    throw new Error('financial_proposal_materialization_unavailable');
  }
}

export async function acceptMyFinancialProposalAsOfferer(
  input: AcceptFinancialProposalAsOffererInput,
): Promise<FinancialProposalOffererConsent> {
  const uuid = (v: unknown): v is string => typeof v === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const timestamp = (v: unknown): v is string => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(v);
    if (!m) return false;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6]) < 60
      && (!m[7] || (Number(m[7]) < 24 && Number(m[8]) < 60));
  };
  try {
    if (!input || !uuid(input.financialProposalId) || !uuid(input.movementOfferId)
      || !Number.isInteger(input.expectedProposalVersion) || input.expectedProposalVersion < 1
      || input.expectedProposalVersion > 2147483647) throw new Error();
    const { data, error } = await supabase.rpc('accept_my_financial_proposal_as_offerer', {
      p_financial_proposal_id: input.financialProposalId,
      p_expected_proposal_version: input.expectedProposalVersion,
      p_movement_offer_id: input.movementOfferId,
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error();
    const value: unknown = data[0];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const r = value as Record<string, unknown>;
    const keys = ['movement_offer_id','offering_accepted_at','proposal_id','proposal_status','proposal_version'];
    const actual = Object.keys(r).sort();
    if (actual.length !== keys.length || actual.some((key, i) => key !== keys[i])
      || !uuid(r.proposal_id) || r.proposal_id.toLowerCase() !== input.financialProposalId.toLowerCase()
      || r.proposal_version !== input.expectedProposalVersion || r.proposal_status !== 'current'
      || !uuid(r.movement_offer_id) || r.movement_offer_id.toLowerCase() !== input.movementOfferId.toLowerCase()
      || !timestamp(r.offering_accepted_at)) throw new Error();
    return { proposalId: r.proposal_id, proposalVersion: input.expectedProposalVersion,
      proposalStatus: 'current', movementOfferId: r.movement_offer_id, offeringAcceptedAt: r.offering_accepted_at };
  } catch {
    throw new Error('financial_proposal_consent_unavailable');
  }
}

export async function getMyFinancialProposal(financialProposalId: string): Promise<SafeFinancialProposal | null> {
  const uuid = (v: unknown): v is string => typeof v === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const integer = (v: unknown, min: number): v is number => typeof v === 'number'
    && Number.isSafeInteger(v) && v >= min;
  const label = (v: unknown): v is string => typeof v === 'string'
    && !!v.trim() && v.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
  const timestamp = (v: unknown): v is string => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60
      && (!match[7] || (Number(match[8]) < 24 && Number(match[9]) < 60));
  };
  try {
    if (!uuid(financialProposalId)) throw new Error();
    const { data, error } = await supabase.rpc('get_my_financial_proposal', {
      p_financial_proposal_id: financialProposalId,
    });
    if (error || !Array.isArray(data) || data.length > 1) throw new Error();
    if (data.length === 0) return null;
    const value: unknown = data[0];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const r = value as Record<string, unknown>;
    const keys = ['proposal_id','proposal_version','proposal_status','created_at','expires_at','caller_role','currency',
      'quoted_platform_fee_total_minor','quoted_movement_contribution_minor','origin_area','destination_area',
      'earliest_departure_at','latest_departure_at','people_count','seats_offered','vehicle_seat_capacity',
      'proposed_pickup_area','proposed_dropoff_area','estimated_arrival_minutes','offering_accepted_at','requester_accepted_at'].sort();
    const actual = Object.keys(r).sort();
    if (actual.length !== keys.length || actual.some((k, i) => k !== keys[i])
      || !uuid(r.proposal_id) || r.proposal_id.toLowerCase() !== financialProposalId.toLowerCase()
      || !integer(r.proposal_version, 1) || r.proposal_version > 2147483647
      || (r.proposal_status !== 'current' && r.proposal_status !== 'superseded')
      || (r.caller_role !== 'requester' && r.caller_role !== 'offerer')
      || typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency)
      || !integer(r.quoted_platform_fee_total_minor, 0) || !integer(r.quoted_movement_contribution_minor, 0)
      || !label(r.origin_area) || !label(r.destination_area)
      || !timestamp(r.created_at) || !timestamp(r.expires_at) || Date.parse(r.expires_at) <= Date.parse(r.created_at)
      || !timestamp(r.earliest_departure_at)
      || (r.latest_departure_at !== null && (!timestamp(r.latest_departure_at) || Date.parse(r.latest_departure_at) < Date.parse(r.earliest_departure_at)))
      || !integer(r.people_count, 1) || !integer(r.seats_offered, 1) || !integer(r.vehicle_seat_capacity, 1)
      || r.people_count > r.seats_offered || r.seats_offered > r.vehicle_seat_capacity || r.vehicle_seat_capacity > 12
      || (r.proposed_pickup_area !== null && !label(r.proposed_pickup_area))
      || (r.proposed_dropoff_area !== null && !label(r.proposed_dropoff_area))
      || (r.estimated_arrival_minutes !== null && (!integer(r.estimated_arrival_minutes, 0) || r.estimated_arrival_minutes > 2147483647))) throw new Error();
    for (const key of ['offering_accepted_at','requester_accepted_at']) {
      if (r[key] !== null && (!timestamp(r[key]) || Date.parse(r[key]) < Date.parse(r.created_at)
        || Date.parse(r[key]) >= Date.parse(r.expires_at))) throw new Error();
    }
    if (r.requester_accepted_at !== null && (r.offering_accepted_at === null
      || Date.parse(r.requester_accepted_at as string) < Date.parse(r.offering_accepted_at as string))) throw new Error();
    return {
      proposalId: r.proposal_id, proposalVersion: r.proposal_version, proposalStatus: r.proposal_status,
      createdAt: r.created_at, expiresAt: r.expires_at, callerRole: r.caller_role, currency: r.currency,
      quotedPlatformFeeTotalMinor: r.quoted_platform_fee_total_minor, quotedMovementContributionMinor: r.quoted_movement_contribution_minor,
      originArea: r.origin_area, destinationArea: r.destination_area, earliestDepartureAt: r.earliest_departure_at,
      latestDepartureAt: r.latest_departure_at as string | null, peopleCount: r.people_count,
      seatsOffered: r.seats_offered, vehicleSeatCapacity: r.vehicle_seat_capacity,
      proposedPickupArea: r.proposed_pickup_area as string | null, proposedDropoffArea: r.proposed_dropoff_area as string | null,
      estimatedArrivalMinutes: r.estimated_arrival_minutes as number | null,
      offeringAcceptedAt: r.offering_accepted_at as string | null, requesterAcceptedAt: r.requester_accepted_at as string | null,
    };
  } catch {
    throw new Error('financial_proposal_unavailable');
  }
}

export interface CreateMovementNeedInput {
  requestId: string;
  originLocationReferenceId: string;
  destinationLocationReferenceId: string;
  earliestDepartureAt: string;
  latestDepartureAt?: string | null;
  peopleCount?: number;
}

export interface CreatedMovementNeed {
  movementNeedId: string;
}

interface RecoverableMovementNeedRow {
  movement_need_id: string;
}

export async function recoverLatestActiveMovementNeed(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_my_current_movement_need');

  if (error) {
    throw new Error('movement_need_recovery_unavailable');
  }

  const rows = data as RecoverableMovementNeedRow[] | null;

  return rows?.[0]?.movement_need_id ?? null;
}

export async function recoverRequesterMovementContinuation(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_requester_movement_continuation');
    if (error || !Array.isArray(data) || data.length > 1) {
      throw new Error('Invalid continuation response');
    }
    if (data.length === 0) return null;

    const row: unknown = data[0];
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== 1 || !('movement_need_id' in row)
      || typeof row.movement_need_id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)) {
      throw new Error('Invalid continuation response');
    }
    return row.movement_need_id;
  } catch {
    throw new Error('movement_continuation_recovery_unavailable');
  }
}

export type OffererMovementContinuation = {
  movementNeedId: string;
  alignmentStatus: 'awaiting_activation_payment' | 'activated';
  originArea: string;
  destinationArea: string;
  createdAt: string;
};

export async function listMyOffererMovementContinuations(
  limit: number = 20,
): Promise<OffererMovementContinuation[]> {
  const safeLabel = (value: unknown): value is string => typeof value === 'string'
    && !!value.trim() && value.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const timestamp = (value: unknown): value is string => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && hour < 24 && minute < 60 && second < 60;
  };
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
    const { data, error } = await supabase.rpc(
      'list_my_offerer_movement_continuations', { p_limit: limit },
    );
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const keys = ['alignment_status', 'created_at', 'destination_area', 'movement_need_id', 'origin_area'];
    const seen = new Set<string>();
    return data.map((value: unknown): OffererMovementContinuation => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      const actual = Object.keys(row).sort();
      if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])
        || typeof row.movement_need_id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)
        || seen.has(row.movement_need_id.toLowerCase())
        || (row.alignment_status !== 'awaiting_activation_payment' && row.alignment_status !== 'activated')
        || !safeLabel(row.origin_area) || !safeLabel(row.destination_area) || !timestamp(row.created_at)) {
        throw new Error();
      }
      seen.add(row.movement_need_id.toLowerCase());
      return {
        movementNeedId: row.movement_need_id, alignmentStatus: row.alignment_status,
        originArea: row.origin_area, destinationArea: row.destination_area, createdAt: row.created_at,
      };
    });
  } catch {
    throw new Error('offerer_movement_continuation_recovery_unavailable');
  }
}

export type ActiveMovementContinuation = {
  movementNeedId: string;
  originArea: string;
  destinationArea: string;
  startedAt: string;
};

export async function listMyActiveMovementContinuations(
  limit: number = 20,
): Promise<ActiveMovementContinuation[]> {
  const safeLabel = (value: unknown): value is string => typeof value === 'string'
    && !!value.trim() && value.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const timestamp = (value: unknown): value is string => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && hour < 24 && minute < 60 && second < 60;
  };
  try {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error();
    const { data, error } = await supabase.rpc(
      'list_my_active_movement_continuations', { p_limit: limit },
    );
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const keys = ['destination_area', 'movement_need_id', 'origin_area', 'started_at'];
    const seen = new Set<string>();
    return data.map((value: unknown): ActiveMovementContinuation => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      const actual = Object.keys(row).sort();
      if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])
        || typeof row.movement_need_id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.movement_need_id)
        || seen.has(row.movement_need_id.toLowerCase())
        || !safeLabel(row.origin_area) || !safeLabel(row.destination_area) || !timestamp(row.started_at)) {
        throw new Error();
      }
      seen.add(row.movement_need_id.toLowerCase());
      return {
        movementNeedId: row.movement_need_id,
        originArea: row.origin_area, destinationArea: row.destination_area, startedAt: row.started_at,
      };
    });
  } catch {
    throw new Error('active_movement_recovery_unavailable');
  }
}

interface CreatedMovementNeedRpcRow {
  movement_need_id: string;
}

interface MaskedMovementNeedRpcRow {
  movement_need_id: string;
  origin_area: string;
  destination_area: string;
  earliest_departure_at: string;
  latest_departure_at: string | null;
  people_count: number;
  age: number | null;
  common_movement_area: string | null;
  identity_verified: boolean;
  profile_media_verified: boolean;
  completed_movements: number;
  rating: number | null;
}

interface CreatedMovementOfferRpcRow {
  movement_offer_id: string;
  status: string;
  created_at: string;
}

interface MaskedMovementOfferRpcRow {
  movement_offer_id: string;
  seats_offered: number;
  estimated_arrival_minutes: number | null;
  offer_status: string;
  offer_created_at: string;
  vehicle_make: string;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string;
  vehicle_seat_capacity: number;
  age: number | null;
  common_movement_area: string | null;
  identity_verified: boolean;
  profile_media_verified: boolean;
  completed_movements: number;
  rating: number | null;
}

interface AcceptedAlignmentRpcRow {
  alignment_id: string;
  alignment_status: string;
  movement_need_id: string;
  movement_offer_id: string;
  created_at: string;
}

interface AlignmentStatusSummaryRpcRow {
  alignment_id: string;
  movement_need_id: string;
  movement_offer_id: string;
  alignment_status: string;
  activation_fee_minor: number | null;
  activation_currency: string;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PostActivationPersonRpcRow {
  person_number: number;
  person_role: PostActivationPerson['personRole'];
  first_name: string | null;
  age: number | null;
  verified: boolean;
  rating: number | null;
  completed_movements: number;
  profile_photo_token: string | null;
  profile_photo_expires_at: string | null;
}

interface PostActivationVehicleRpcRow {
  vehicle_display_name: string;
  plate_number: string;
}

export async function createMovementNeed(
  input: CreateMovementNeedInput
): Promise<CreatedMovementNeed> {
  const { data, error } = await supabase.rpc('create_movement_need', {
    p_request_id: input.requestId,
    p_origin_location_reference_id: input.originLocationReferenceId,
    p_destination_location_reference_id: input.destinationLocationReferenceId,
    p_earliest_departure_at: input.earliestDepartureAt,
    p_latest_departure_at: input.latestDepartureAt ?? null,
    p_people_count: input.peopleCount ?? 1,
  });

  if (error) {
    throw error;
  }

  const row = (data as CreatedMovementNeedRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error(
      'No movement need data returned from create_movement_need'
    );
  }

  return {
    movementNeedId: row.movement_need_id,
  };
}

export async function discoverMaskedMovementNeeds(
  limit: number = 20
): Promise<MaskedMovementNeed[]> {
  const { data, error } = await supabase.rpc('discover_masked_movement_needs', {
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as MaskedMovementNeedRpcRow[];

  return rows.map((row) => ({
    movementNeedId: row.movement_need_id,
    originArea: row.origin_area,
    destinationArea: row.destination_area,
    earliestDepartureAt: row.earliest_departure_at,
    latestDepartureAt: row.latest_departure_at,
    peopleCount: row.people_count,
    age: row.age,
    commonMovementArea: row.common_movement_area,
    identityVerified: row.identity_verified,
    profileMediaVerified: row.profile_media_verified,
    completedMovements: row.completed_movements,
    rating: row.rating,
  }));
}

export async function createMovementOffer(
  input: CreateMovementOfferInput
): Promise<CreatedMovementOffer> {
  const { data, error } = await supabase.rpc('create_movement_offer', {
    p_movement_need_id: input.movementNeedId,
    p_route_match_evidence_id: input.routeMatchEvidenceId,
    p_availability_id: input.availabilityId,
    p_seats_offered: input.seatsOffered,
    p_proposed_pickup_area: input.proposedPickupArea ?? null,
    p_proposed_dropoff_area: input.proposedDropoffArea ?? null,
    p_estimated_arrival_minutes: input.estimatedArrivalMinutes ?? null,
  });

  if (error) {
    throw error;
  }

  const row = (data as CreatedMovementOfferRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No movement offer data returned from create_movement_offer');
  }

  return {
    movementOfferId: row.movement_offer_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export interface CreateMovementOfferFromInterestInput {
  interestId: string;
  seatsOffered: number;
  proposedPickupArea?: string | null;
  proposedDropoffArea?: string | null;
  estimatedArrivalMinutes?: number | null;
}

export async function createMovementOfferFromInterest(
  input: CreateMovementOfferFromInterestInput
): Promise<CreatedMovementOffer> {
  const { data, error } = await supabase.rpc(
    'create_movement_offer_from_interest',
    {
      p_interest_id: input.interestId,
      p_seats_offered: input.seatsOffered,
      p_proposed_pickup_area:
        input.proposedPickupArea ?? null,
      p_proposed_dropoff_area:
        input.proposedDropoffArea ?? null,
      p_estimated_arrival_minutes:
        input.estimatedArrivalMinutes ?? null,
    }
  );

  if (error) {
    throw error;
  }

  const row =
    (data as CreatedMovementOfferRpcRow[] | null)?.[0]
    ?? null;

  if (!row) {
    throw new Error(
      'No movement offer data returned from create_movement_offer_from_interest'
    );
  }

  return {
    movementOfferId: row.movement_offer_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function discoverMaskedOffersForMyNeed(
  movementNeedId: string,
  limit: number = 20
): Promise<MaskedMovementOffer[]> {
  const { data, error } = await supabase.rpc('discover_masked_offers_for_my_need', {
    p_movement_need_id: movementNeedId,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as MaskedMovementOfferRpcRow[];

  return rows.map((row) => ({
    movementOfferId: row.movement_offer_id,
    seatsOffered: row.seats_offered,
    estimatedArrivalMinutes: row.estimated_arrival_minutes,
    offerStatus: row.offer_status,
    offerCreatedAt: row.offer_created_at,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehicleColor: row.vehicle_color,
    vehicleSeatCapacity: row.vehicle_seat_capacity,
    age: row.age,
    commonMovementArea: row.common_movement_area,
    identityVerified: row.identity_verified,
    profileMediaVerified: row.profile_media_verified,
    completedMovements: row.completed_movements,
    rating: row.rating,
  }));
}

export async function acceptMovementOffer(
  movementOfferId: string
): Promise<AcceptedAlignment> {
  const { data, error } = await supabase.rpc('accept_movement_offer', {
    p_movement_offer_id: movementOfferId,
  });

  if (error) {
    throw error;
  }

  const row = (data as AcceptedAlignmentRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No alignment data returned from accept_movement_offer');
  }

  return {
    alignmentId: row.alignment_id,
    alignmentStatus: row.alignment_status,
    movementNeedId: row.movement_need_id,
    movementOfferId: row.movement_offer_id,
    createdAt: row.created_at,
  };
}

export async function getMyAlignmentStatus(
  alignmentId: string
): Promise<AlignmentStatusSummary> {
  const { data, error } = await supabase.rpc('get_my_alignment_status', {
    p_alignment_id: alignmentId,
  });

  if (error) {
    throw error;
  }

  const row = (data as AlignmentStatusSummaryRpcRow[] | null)?.[0] ?? null;

  if (!row) {
    throw new Error('No alignment status data returned from get_my_alignment_status');
  }

  return {
    alignmentId: row.alignment_id,
    movementNeedId: row.movement_need_id,
    movementOfferId: row.movement_offer_id,
    alignmentStatus: row.alignment_status,
    activationFeeMinor: row.activation_fee_minor,
    activationCurrency: row.activation_currency,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPostActivationPeople(
  movementNeedId: string
): Promise<PostActivationPerson[]> {
  const { data, error } = await supabase.rpc('get_post_activation_people', {
    p_movement_need_id: movementNeedId,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as PostActivationPersonRpcRow[];

  return rows.map((row) => ({
    personNumber: row.person_number,
    personRole: row.person_role,
    firstName: row.first_name,
    age: row.age,
    verified: row.verified,
    rating: row.rating,
    completedMovements: row.completed_movements,
    profilePhotoToken: row.profile_photo_token,
    profilePhotoExpiresAt: row.profile_photo_expires_at,
  }));
}

export async function getPostActivationVehicle(
  movementNeedId: string
): Promise<PostActivationVehicle | null> {
  const { data, error } = await supabase.rpc('get_post_activation_vehicle', {
    p_movement_need_id: movementNeedId,
  });

  if (error) {
    throw error;
  }

  const row = (data as PostActivationVehicleRpcRow[] | null)?.[0];

  if (!row) {
    return null;
  }

  return {
    vehicleDisplayName: row.vehicle_display_name,
    plateNumber: row.plate_number,
  };
}
