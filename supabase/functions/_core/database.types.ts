export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_generations: {
        Row: {
          created_at: string
          failure_reason: string | null
          finished_at: string | null
          id: number
          latency_ms: number | null
          model: string
          operation: string
          provider: string
          request_id: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          version_id: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          finished_at?: string | null
          id?: never
          latency_ms?: number | null
          model: string
          operation: string
          provider: string
          request_id?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          version_id?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          finished_at?: string | null
          id?: never
          latency_ms?: number | null
          model?: string
          operation?: string
          provider?: string
          request_id?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          age: number | null
          birth_date: string | null
          chronic_conditions: string | null
          client_id: string
          created_at: string
          days_per_week: number
          equipment: string
          equipment_detail: string | null
          gender: string | null
          goal: string
          has_limitations: boolean
          height_cm: number | null
          id: string
          last_weighed: string | null
          level: string
          lifestyle: string | null
          limitations_detail: string | null
          medications: string | null
          menopause_stage: string | null
          notes: string | null
          quit_reasons: string | null
          raw_payload: Json
          session_minutes: number
          weight_kg: number | null
        }
        Insert: {
          age?: number | null
          birth_date?: string | null
          chronic_conditions?: string | null
          client_id: string
          created_at?: string
          days_per_week: number
          equipment: string
          equipment_detail?: string | null
          gender?: string | null
          goal: string
          has_limitations: boolean
          height_cm?: number | null
          id?: string
          last_weighed?: string | null
          level: string
          lifestyle?: string | null
          limitations_detail?: string | null
          medications?: string | null
          menopause_stage?: string | null
          notes?: string | null
          quit_reasons?: string | null
          raw_payload: Json
          session_minutes: number
          weight_kg?: number | null
        }
        Update: {
          age?: number | null
          birth_date?: string | null
          chronic_conditions?: string | null
          client_id?: string
          created_at?: string
          days_per_week?: number
          equipment?: string
          equipment_detail?: string | null
          gender?: string | null
          goal?: string
          has_limitations?: boolean
          height_cm?: number | null
          id?: string
          last_weighed?: string | null
          level?: string
          lifestyle?: string | null
          limitations_detail?: string | null
          medications?: string | null
          menopause_stage?: string | null
          notes?: string | null
          quit_reasons?: string | null
          raw_payload?: Json
          session_minutes?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          asked_at: string
          client_id: string
          comment: string | null
          created_at: string
          id: string
          reason: Database["public"]["Enums"]["change_reason"]
          resolved_at: string | null
          resolved_by_version_id: string | null
          state: string
          version_id: string
        }
        Insert: {
          asked_at?: string
          client_id: string
          comment?: string | null
          created_at?: string
          id?: string
          reason: Database["public"]["Enums"]["change_reason"]
          resolved_at?: string | null
          resolved_by_version_id?: string | null
          state?: string
          version_id: string
        }
        Update: {
          asked_at?: string
          client_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          reason?: Database["public"]["Enums"]["change_reason"]
          resolved_at?: string | null
          resolved_by_version_id?: string | null
          state?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_resolved_by_version_id_fkey"
            columns: ["resolved_by_version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          answers: Json | null
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          reminder_sent_at: string | null
          sent_at: string | null
          state: string
          version_id: string
          week_number: number
        }
        Insert: {
          answers?: Json | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          reminder_sent_at?: string | null
          sent_at?: string | null
          state?: string
          version_id: string
          week_number: number
        }
        Update: {
          answers?: Json | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          reminder_sent_at?: string | null
          sent_at?: string | null
          state?: string
          version_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "checkins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkins_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          client_role: Database["public"]["Enums"]["user_role"]
          created_at: string
          full_name: string
          id: string
          link_token: string
          linked_at: string | null
          profile_id: string | null
          trainer_id: string
          trainer_role: Database["public"]["Enums"]["user_role"]
          update_token_expires_at: string | null
          update_token_hash: string | null
        }
        Insert: {
          client_role?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          full_name: string
          id?: string
          link_token: string
          linked_at?: string | null
          profile_id?: string | null
          trainer_id: string
          trainer_role?: Database["public"]["Enums"]["user_role"]
          update_token_expires_at?: string | null
          update_token_hash?: string | null
        }
        Update: {
          client_role?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          full_name?: string
          id?: string
          link_token?: string
          linked_at?: string | null
          profile_id?: string | null
          trainer_id?: string
          trainer_role?: Database["public"]["Enums"]["user_role"]
          update_token_expires_at?: string | null
          update_token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_profile_must_be_client"
            columns: ["profile_id", "client_role"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "role"]
          },
          {
            foreignKeyName: "clients_trainer_must_be_trainer"
            columns: ["trainer_id", "trainer_role"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "role"]
          },
        ]
      }
      plan_events: {
        Row: {
          actor: string
          created_at: string
          event_type: string
          from_state: Database["public"]["Enums"]["version_state"] | null
          id: number
          metadata: Json | null
          plan_id: string
          request_id: string | null
          to_state: Database["public"]["Enums"]["version_state"] | null
          version_id: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          event_type: string
          from_state?: Database["public"]["Enums"]["version_state"] | null
          id?: never
          metadata?: Json | null
          plan_id: string
          request_id?: string | null
          to_state?: Database["public"]["Enums"]["version_state"] | null
          version_id?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          event_type?: string
          from_state?: Database["public"]["Enums"]["version_state"] | null
          id?: never
          metadata?: Json | null
          plan_id?: string
          request_id?: string | null
          to_state?: Database["public"]["Enums"]["version_state"] | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "workout_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_events_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          telegram_chat_id: number | null
          telegram_user_id: number
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          telegram_chat_id?: number | null
          telegram_user_id: number
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          telegram_chat_id?: number | null
          telegram_user_id?: number
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          external_id: string
          id: number
          payload: Json
          processed_at: string | null
          request_id: string | null
          source: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: never
          payload: Json
          processed_at?: string | null
          request_id?: string | null
          source: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: never
          payload?: Json
          processed_at?: string | null
          request_id?: string | null
          source?: string
        }
        Relationships: []
      }
      workout_plans: {
        Row: {
          assessment_id: string | null
          client_id: string
          created_at: string
          current_version_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          assessment_id?: string | null
          client_id: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string | null
          client_id?: string
          created_at?: string
          current_version_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_plans_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_plans_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "workout_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_versions: {
        Row: {
          content: Json | null
          created_at: string
          created_by: string
          edit_count: number
          id: string
          plan_id: string
          sent_at: string | null
          source: Database["public"]["Enums"]["version_source"]
          state: Database["public"]["Enums"]["version_state"]
          template_id: string | null
          trainer_feedback: string | null
          updated_at: string
          version_number: number
        }
        Insert: {
          content?: Json | null
          created_at?: string
          created_by: string
          edit_count?: number
          id?: string
          plan_id: string
          sent_at?: string | null
          source: Database["public"]["Enums"]["version_source"]
          state?: Database["public"]["Enums"]["version_state"]
          template_id?: string | null
          trainer_feedback?: string | null
          updated_at?: string
          version_number: number
        }
        Update: {
          content?: Json | null
          created_at?: string
          created_by?: string
          edit_count?: number
          id?: string
          plan_id?: string
          sent_at?: string | null
          source?: Database["public"]["Enums"]["version_source"]
          state?: Database["public"]["Enums"]["version_state"]
          template_id?: string | null
          trainer_feedback?: string | null
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "workout_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "workout_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_change_comment: {
        Args: { p_client_id: string; p_comment: string; p_request_id: string }
        Returns: {
          saved: boolean
          truncated: boolean
        }[]
      }
      apply_version_transition: {
        Args: {
          p_actor: string
          p_expected_state: Database["public"]["Enums"]["version_state"]
          p_metadata?: Json
          p_new_state: Database["public"]["Enums"]["version_state"]
          p_request_id?: string
          p_version_id: string
        }
        Returns: boolean
      }
      approved_version_for_client: {
        Args: { p_client_id: string }
        Returns: {
          client_chat_id: number
          client_name: string
          content: Json
          days_per_week: number
          goal: string
          session_minutes: number
          state: Database["public"]["Enums"]["version_state"]
          trainer_chat_id: number
          version_id: string
        }[]
      }
      assessment_for_version: {
        Args: { p_version_id: string }
        Returns: {
          age: number
          birth_date: string
          chronic_conditions: string
          client_id: string
          client_name: string
          client_profile_id: string
          days_per_week: number
          equipment: string
          equipment_detail: string
          gender: string
          goal: string
          has_limitations: boolean
          height_cm: number
          last_weighed: string
          level: string
          lifestyle: string
          limitations_detail: string
          medications: string
          menopause_stage: string
          notes: string
          quit_reasons: string
          session_minutes: number
          state: Database["public"]["Enums"]["version_state"]
          submitted_at: string
          trainer_id: string
          version_id: string
          weight_kg: number
        }[]
      }
      change_request_for_trainer: {
        Args: { p_request_id: string }
        Returns: {
          client_name: string
          comment: string
          plan_id: string
          reason: Database["public"]["Enums"]["change_reason"]
          request_id: string
          sent_days_ago: number
          state: string
          trainer_id: string
          version_id: string
          version_number: number
        }[]
      }
      checkin_candidates: {
        Args: never
        Returns: {
          client_chat_id: number
          client_id: string
          client_name: string
          last_week_sent: number
          sent_at: string
          state: Database["public"]["Enums"]["version_state"]
          version_id: string
        }[]
      }
      checkin_for_reply: {
        Args: { p_checkin_id: string }
        Returns: {
          answers: Json
          checkin_id: string
          client_name: string
          client_profile_id: string
          days_per_week: number
          sent_at: string
          state: string
          trainer_chat_id: number
          week_number: number
        }[]
      }
      checkins_to_remind: {
        Args: never
        Returns: {
          checkin_id: string
          client_chat_id: number
          reminder_sent_at: string
          sent_at: string
          state: string
          week_number: number
        }[]
      }
      client_for_link: {
        Args: { p_token: string }
        Returns: {
          client_id: string
          full_name: string
          linked_profile_id: string
          linked_telegram_user_id: number
          trainer_chat_id: number
        }[]
      }
      client_for_resend: {
        Args: { p_version_id: string }
        Returns: {
          client_id: string
          full_name: string
          link_token: string
          linked: boolean
          profile_id: string
          trainer_id: string
        }[]
      }
      create_checkin: {
        Args: {
          p_client_id: string
          p_version_id: string
          p_week_number: number
        }
        Returns: string
      }
      create_workout_version: {
        Args: {
          p_content?: Json
          p_created_by: string
          p_plan_id: string
          p_request_id?: string
          p_source: Database["public"]["Enums"]["version_source"]
          p_template_id?: string
        }
        Returns: string
      }
      current_draft_for_trainer: {
        Args: { p_trainer_id: string }
        Returns: {
          client_name: string
          content: Json
          version_id: string
          version_number: number
        }[]
      }
      dearmor: { Args: { "": string }; Returns: string }
      ensure_client_profile: {
        Args: {
          p_chat_id: number
          p_full_name: string
          p_telegram_user_id: number
        }
        Returns: string
      }
      fill_version: {
        Args: {
          p_content: Json
          p_expected_state: Database["public"]["Enums"]["version_state"]
          p_request_id?: string
          p_source: Database["public"]["Enums"]["version_source"]
          p_template_id: string
          p_version_id: string
        }
        Returns: boolean
      }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      ingest_assessment: {
        Args: {
          p_age?: number
          p_birth_date?: string
          p_chronic_conditions?: string
          p_days_per_week: number
          p_equipment: string
          p_equipment_detail?: string
          p_full_name: string
          p_gender?: string
          p_goal: string
          p_has_limitations: boolean
          p_height_cm?: number
          p_last_weighed?: string
          p_level: string
          p_lifestyle?: string
          p_limitations_detail?: string
          p_link_token: string
          p_medications?: string
          p_menopause_stage?: string
          p_notes?: string
          p_quit_reasons?: string
          p_raw_payload: Json
          p_request_id?: string
          p_session_minutes: number
          p_trainer_id: string
          p_weight_kg?: number
        }
        Returns: {
          assessment_id: string
          client_id: string
          plan_id: string
          version_id: string
        }[]
      }
      ingest_assessment_update: {
        Args: {
          p_age?: number
          p_birth_date?: string
          p_chronic_conditions?: string
          p_days_per_week: number
          p_equipment: string
          p_equipment_detail?: string
          p_gender?: string
          p_goal: string
          p_has_limitations: boolean
          p_height_cm?: number
          p_last_weighed?: string
          p_level: string
          p_lifestyle?: string
          p_limitations_detail?: string
          p_medications?: string
          p_menopause_stage?: string
          p_notes?: string
          p_quit_reasons?: string
          p_raw_payload: Json
          p_session_minutes: number
          p_token: string
          p_weight_kg?: number
        }
        Returns: {
          assessment_id: string
          client_chat_id: number
          client_id: string
          client_name: string
          plan_id: string
          previous: Json
          version_id: string
          version_state: Database["public"]["Enums"]["version_state"]
        }[]
      }
      issue_update_token_for_client: {
        Args: { p_client_id: string; p_token: string }
        Returns: number
      }
      issue_update_token_for_profile: {
        Args: { p_profile_id: string; p_token: string }
        Returns: string
      }
      link_client: {
        Args: { p_client_id: string; p_profile_id: string }
        Returns: boolean
      }
      mark_checkin_reminded: {
        Args: { p_checkin_id: string }
        Returns: undefined
      }
      mark_checkin_sent: { Args: { p_checkin_id: string }; Returns: undefined }
      open_change_request_for_client: {
        Args: { p_profile_id: string }
        Returns: {
          asked_at: string
          client_id: string
          created_at: string
          has_comment: boolean
          reason: Database["public"]["Enums"]["change_reason"]
          request_id: string
          version_id: string
        }[]
      }
      open_checkin_for_profile: {
        Args: { p_profile_id: string }
        Returns: {
          answers: Json
          checkin_id: string
          client_name: string
          client_profile_id: string
          days_per_week: number
          sent_at: string
          state: string
          trainer_chat_id: number
          week_number: number
        }[]
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      record_version_accepted: {
        Args: {
          p_client_id: string
          p_request_id?: string
          p_version_id: string
        }
        Returns: undefined
      }
      request_change: {
        Args: {
          p_client_id: string
          p_comment?: string
          p_reason: Database["public"]["Enums"]["change_reason"]
          p_version_id: string
        }
        Returns: {
          created: boolean
          id: string
        }[]
      }
      resolve_change_requests: {
        Args: { p_version_id: string }
        Returns: number
      }
      save_checkin_answers: {
        Args: { p_answers: Json; p_checkin_id: string; p_completed: boolean }
        Returns: undefined
      }
      save_draft_content: {
        Args: { p_content: Json; p_version_id: string }
        Returns: boolean
      }
      sent_version_for_profile: {
        Args: { p_profile_id: string }
        Returns: {
          client_chat_id: number
          client_name: string
          content: Json
          days_per_week: number
          goal: string
          session_minutes: number
          state: Database["public"]["Enums"]["version_state"]
          trainer_chat_id: number
          version_id: string
        }[]
      }
      stale_generating_versions: {
        Args: { p_min_minutes: number }
        Returns: {
          client_name: string
          minutes_stuck: number
          trainer_chat_id: number
          version_id: string
        }[]
      }
      touch_change_request_ask: {
        Args: { p_client_id: string; p_request_id: string }
        Returns: boolean
      }
      trainer_client_detail: {
        Args: { p_client_id: string }
        Returns: {
          client_id: string
          days_per_week: number
          equipment: string
          full_name: string
          goal: string
          has_limitations: boolean
          last_answers: Json
          last_week_number: number
          level: string
          linked: boolean
          pending_checkin_days: number
          sent_days_ago: number
          session_minutes: number
          version_id: string
          version_number: number
          version_state: Database["public"]["Enums"]["version_state"]
        }[]
      }
      trainer_clients: {
        Args: { p_trainer_id: string }
        Returns: {
          client_id: string
          full_name: string
          linked: boolean
          pending_checkin_days: number
          version_number: number
          version_state: Database["public"]["Enums"]["version_state"]
        }[]
      }
      trainer_pending_versions: {
        Args: { p_trainer_id: string }
        Returns: {
          client_name: string
          days_waiting: number
          version_id: string
          version_number: number
        }[]
      }
      trainer_stale_checkins: {
        Args: { p_min_days: number; p_trainer_id: string }
        Returns: {
          client_name: string
          days_waiting: number
          reminded: boolean
          week_number: number
        }[]
      }
      update_token_hash: { Args: { p_token: string }; Returns: string }
      version_for_action: {
        Args: { p_version_id: string }
        Returns: {
          client_id: string
          client_name: string
          client_profile_id: string
          content: Json
          days_per_week: number
          has_limitations: boolean
          state: Database["public"]["Enums"]["version_state"]
          trainer_id: string
          version_id: string
          version_number: number
        }[]
      }
      version_for_creation: {
        Args: { p_version_id: string }
        Returns: {
          client_id: string
          client_name: string
          client_profile_id: string
          days_per_week: number
          equipment: string
          has_limitations: boolean
          level: string
          state: Database["public"]["Enums"]["version_state"]
          trainer_id: string
          version_id: string
          version_number: number
        }[]
      }
      version_for_delivery: {
        Args: { p_version_id: string }
        Returns: {
          client_chat_id: number
          client_name: string
          content: Json
          days_per_week: number
          goal: string
          session_minutes: number
          state: Database["public"]["Enums"]["version_state"]
          trainer_chat_id: number
          version_id: string
        }[]
      }
      version_for_generation: {
        Args: { p_version_id: string }
        Returns: {
          age: number
          chronic_conditions: string
          client_name: string
          days_per_week: number
          equipment: string
          equipment_detail: string
          gender: string
          goal: string
          has_limitations: boolean
          height_cm: number
          last_weighed: string
          level: string
          lifestyle: string
          limitations: string
          medications: string
          menopause_stage: string
          notes: string
          quit_reasons: string
          session_minutes: number
          state: Database["public"]["Enums"]["version_state"]
          trainer_chat_id: number
          version_id: string
          version_number: number
          weight_kg: number
        }[]
      }
      version_for_request: {
        Args: { p_version_id: string }
        Returns: {
          client_id: string
          client_name: string
          client_profile_id: string
          plan_id: string
          state: Database["public"]["Enums"]["version_state"]
          trainer_chat_id: number
          trainer_id: string
          version_id: string
          version_number: number
        }[]
      }
    }
    Enums: {
      change_reason:
        | "too_hard"
        | "too_easy"
        | "too_long"
        | "no_equipment"
        | "uncomfortable_exercise"
        | "want_variety"
        | "other"
      user_role: "trainer" | "client"
      version_source: "ai" | "template" | "manual"
      version_state:
        | "NEW"
        | "GENERATING"
        | "DRAFT"
        | "APPROVED"
        | "SENT"
        | "REJECTED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      change_reason: [
        "too_hard",
        "too_easy",
        "too_long",
        "no_equipment",
        "uncomfortable_exercise",
        "want_variety",
        "other",
      ],
      user_role: ["trainer", "client"],
      version_source: ["ai", "template", "manual"],
      version_state: [
        "NEW",
        "GENERATING",
        "DRAFT",
        "APPROVED",
        "SENT",
        "REJECTED",
      ],
    },
  },
} as const

