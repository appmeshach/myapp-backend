BEGIN;

-- Obligation-only publication. No operational caller reads these tables yet.
-- All economics are immutable from INSERT; there is no editable draft phase.
CREATE TABLE private.financial_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alignment_id uuid NOT NULL REFERENCES public.alignments(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  member_needing_movement_id uuid NOT NULL REFERENCES public.members(id),
  version integer NOT NULL CHECK (version >= 1),
  financial_model_version text NOT NULL
    CHECK (financial_model_version = 'shared_platform_fee_v1'),
  pricing_policy_version text NOT NULL
    CHECK (length(pricing_policy_version) BETWEEN 1 AND 100
      AND pricing_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  platform_fee_allocation_policy_version text NOT NULL
    CHECK (platform_fee_allocation_policy_version = 'equal_split_requester_remainder_v1'),
  currency text NOT NULL CHECK (length(currency)=3 AND currency ~ '^[A-Z]{3}$'),
  quoted_platform_fee_total_minor bigint NOT NULL CHECK (quoted_platform_fee_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  offering_accepted_at timestamptz,
  requester_accepted_at timestamptz,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  CHECK (offering_member_id <> member_needing_movement_id),
  UNIQUE (alignment_id,version)
);
CREATE UNIQUE INDEX financial_agreements_one_current
  ON private.financial_agreements(alignment_id) WHERE status='current';

CREATE TABLE private.financial_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES private.financial_agreements(id),
  component_key text NOT NULL CHECK (component_key IN (
    'offering_platform_share','requester_platform_share','movement_contribution')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  responsible_member_id uuid NOT NULL REFERENCES public.members(id),
  beneficiary_kind text NOT NULL CHECK (beneficiary_kind IN ('platform','member')),
  beneficiary_member_id uuid REFERENCES public.members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id,component_key),
  CHECK (
    (component_key IN ('offering_platform_share','requester_platform_share')
      AND beneficiary_kind='platform' AND beneficiary_member_id IS NULL)
    OR (component_key='movement_contribution'
      AND beneficiary_kind='member' AND beneficiary_member_id IS NOT NULL)
  )
);

ALTER TABLE private.financial_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.financial_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.financial_agreements,private.financial_components
  FROM PUBLIC,anon,authenticated,service_role;
-- No operational writer exists. Future trusted write RPCs need separate review.
GRANT SELECT ON private.financial_agreements,private.financial_components TO service_role;

CREATE FUNCTION private.protect_financial_agreement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial agreement history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'current' OR NEW.offering_accepted_at IS NOT NULL OR NEW.requester_accepted_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Publish a current unaccepted financial agreement first';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','offering_accepted_at','requester_accepted_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','offering_accepted_at','requester_accepted_at']) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Published financial agreement terms are immutable';
  END IF;
  IF OLD.status='superseded' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseded financial agreement is immutable';
  END IF;
  IF (OLD.offering_accepted_at IS NOT NULL AND NEW.offering_accepted_at IS DISTINCT FROM OLD.offering_accepted_at)
    OR (OLD.requester_accepted_at IS NOT NULL AND NEW.requester_accepted_at IS DISTINCT FROM OLD.requester_accepted_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial acceptance is write-once';
  END IF;
  IF NEW.status='superseded' AND
    ROW(NEW.offering_accepted_at,NEW.requester_accepted_at)
      IS DISTINCT FROM ROW(OLD.offering_accepted_at,OLD.requester_accepted_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Accept the current version before superseding it';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_financial_agreement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_financial_agreement
  BEFORE INSERT OR UPDATE OR DELETE ON private.financial_agreements
  FOR EACH ROW EXECUTE FUNCTION private.protect_financial_agreement();

CREATE FUNCTION private.protect_financial_component()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE agreement_status text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Published financial components are immutable';
  END IF;
  -- Serialize construction with supersession and acceptance on the parent.
  SELECT a.status INTO agreement_status FROM private.financial_agreements a
    WHERE a.id=NEW.agreement_id FOR UPDATE;
  IF agreement_status IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Components require a current financial agreement';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_financial_component() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_financial_component
  BEFORE INSERT OR UPDATE OR DELETE ON private.financial_components
  FOR EACH ROW EXECUTE FUNCTION private.protect_financial_component();

CREATE FUNCTION private.validate_financial_agreement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE agreement_id_to_check uuid; a private.financial_agreements%ROWTYPE;
  alignment_offering uuid; alignment_requester uuid;
  component_count bigint; offering_share bigint; requester_share bigint;
BEGIN
  IF TG_TABLE_NAME='financial_agreements' THEN agreement_id_to_check:=NEW.id;
  ELSE agreement_id_to_check:=NEW.agreement_id; END IF;
  SELECT * INTO STRICT a FROM private.financial_agreements
    WHERE id=agreement_id_to_check FOR UPDATE;
  -- These are the authoritative alignment bindings, already immutable under
  -- 0016. Do not infer principals again from a potentially changed offer/roster.
  SELECT x.offering_member_id,x.member_needing_movement_id
    INTO STRICT alignment_offering,alignment_requester
    FROM public.alignments x WHERE x.id=a.alignment_id FOR SHARE;
  IF a.offering_member_id IS DISTINCT FROM alignment_offering
    OR a.member_needing_movement_id IS DISTINCT FROM alignment_requester THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial principals must match alignment';
  END IF;
  SELECT count(*),
    max(c.amount_minor) FILTER (WHERE c.component_key='offering_platform_share'),
    max(c.amount_minor) FILTER (WHERE c.component_key='requester_platform_share')
    INTO component_count,offering_share,requester_share
    FROM private.financial_components c WHERE c.agreement_id=a.id;
  -- Key CHECK + UNIQUE + count=3 also prove every required key is present.
  -- Apply to superseded versions too: supersession cannot hide incomplete data.
  IF component_count<>3 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial agreement requires exactly three components';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.financial_components c WHERE c.agreement_id=a.id AND (
      c.responsible_member_id IS DISTINCT FROM CASE WHEN c.component_key='offering_platform_share'
        THEN a.offering_member_id ELSE a.member_needing_movement_id END
      OR (c.component_key='movement_contribution' AND c.beneficiary_member_id IS DISTINCT FROM a.offering_member_id)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial component parties must match agreement';
  END IF;
  -- Nonnegative bigint division is floor. The second comparison assigns the
  -- remainder and proves the sum without overflowing on malformed input.
  IF offering_share IS DISTINCT FROM a.quoted_platform_fee_total_minor / 2
    OR requester_share IS DISTINCT FROM a.quoted_platform_fee_total_minor - a.quoted_platform_fee_total_minor / 2 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Platform shares must follow requester-remainder allocation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_financial_agreement() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER financial_agreement_complete
  AFTER INSERT OR UPDATE ON private.financial_agreements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.validate_financial_agreement();
CREATE CONSTRAINT TRIGGER financial_components_complete
  AFTER INSERT ON private.financial_components
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.validate_financial_agreement();

COMMIT;
