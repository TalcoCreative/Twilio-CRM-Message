export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      agent_shifts: {
        Row: {
          agent_id: string
          created_at: string
          effective_from: string
          id: string
          shift_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          effective_from?: string
          id?: string
          shift_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          effective_from?: string
          id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_shifts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_invitations: {
        Row: {
          contact_id: string
          conversation_id: string
          created_at: string
          from_user_id: string
          id: string
          note: string | null
          previous_stage_id: string | null
          reject_reason: string | null
          responded_at: string | null
          snapshot_at: string
          status: string
          to_user_id: string
        }
        Insert: {
          contact_id: string
          conversation_id: string
          created_at?: string
          from_user_id: string
          id?: string
          note?: string | null
          previous_stage_id?: string | null
          reject_reason?: string | null
          responded_at?: string | null
          snapshot_at?: string
          status?: string
          to_user_id: string
        }
        Update: {
          contact_id?: string
          conversation_id?: string
          created_at?: string
          from_user_id?: string
          id?: string
          note?: string | null
          previous_stage_id?: string | null
          reject_reason?: string | null
          responded_at?: string | null
          snapshot_at?: string
          status?: string
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_invitations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_invitations_previous_stage_id_fkey"
            columns: ["previous_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          contact_id: string | null
          conversation_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          new_value: Json | null
          occurred_at: string
          old_value: Json | null
          product_id: string | null
          stage_id: string | null
        }
        Insert: {
          actor_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          product_id?: string | null
          stage_id?: string | null
        }
        Update: {
          actor_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          product_id?: string | null
          stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          age: number | null
          assigned_agent_id: string | null
          chatbot_data: Json | null
          chatbot_state: string | null
          chief_complaint: string | null
          content_code_id: string | null
          created_at: string
          current_medications: string | null
          description: string | null
          document_url: string | null
          domicile: string | null
          email: string | null
          estimated_revenue: number | null
          full_name: string | null
          id: string
          initial_question: string | null
          interested_product_id: string | null
          last_interaction_at: string | null
          need_category: string | null
          notes: string | null
          source: string
          stage_id: string | null
          total_messages: number
          updated_at: string
          whatsapp_number: string
        }
        Insert: {
          age?: number | null
          assigned_agent_id?: string | null
          chatbot_data?: Json | null
          chatbot_state?: string | null
          chief_complaint?: string | null
          content_code_id?: string | null
          created_at?: string
          current_medications?: string | null
          description?: string | null
          document_url?: string | null
          domicile?: string | null
          email?: string | null
          estimated_revenue?: number | null
          full_name?: string | null
          id?: string
          initial_question?: string | null
          interested_product_id?: string | null
          last_interaction_at?: string | null
          need_category?: string | null
          notes?: string | null
          source?: string
          stage_id?: string | null
          total_messages?: number
          updated_at?: string
          whatsapp_number: string
        }
        Update: {
          age?: number | null
          assigned_agent_id?: string | null
          chatbot_data?: Json | null
          chatbot_state?: string | null
          chief_complaint?: string | null
          content_code_id?: string | null
          created_at?: string
          current_medications?: string | null
          description?: string | null
          document_url?: string | null
          domicile?: string | null
          email?: string | null
          estimated_revenue?: number | null
          full_name?: string | null
          id?: string
          initial_question?: string | null
          interested_product_id?: string | null
          last_interaction_at?: string | null
          need_category?: string | null
          notes?: string | null
          source?: string
          stage_id?: string | null
          total_messages?: number
          updated_at?: string
          whatsapp_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_content_code_id_fkey"
            columns: ["content_code_id"]
            isOneToOne: false
            referencedRelation: "content_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_interested_product_id_fkey"
            columns: ["interested_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      content_codes: {
        Row: {
          code: string
          content_link: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          product_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          content_link?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          product_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          content_link?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_agent_id: string | null
          contact_id: string
          created_at: string
          first_inbound_at: string | null
          first_response_at: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_replied_by_id: string | null
          priority: string
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          contact_id: string
          created_at?: string
          first_inbound_at?: string | null
          first_response_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_replied_by_id?: string | null
          priority?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          contact_id?: string
          created_at?: string
          first_inbound_at?: string | null
          first_response_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_replied_by_id?: string | null
          priority?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      fr_date_shifts: {
        Row: {
          agent_id: string
          created_at: string
          end_time: string
          id: string
          start_time: string
          updated_at: string
          work_date: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_code: string | null
          error_message: string | null
          fonnte_message_id: string | null
          id: string
          media_url: string | null
          response_seconds: number | null
          sent_at: string
          sent_by_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          type: Database["public"]["Enums"]["message_type"]
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          fonnte_message_id?: string | null
          id?: string
          media_url?: string | null
          response_seconds?: number | null
          sent_at?: string
          sent_by_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          type?: Database["public"]["Enums"]["message_type"]
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          fonnte_message_id?: string | null
          id?: string
          media_url?: string | null
          response_seconds?: number | null
          sent_at?: string
          sent_by_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          type?: Database["public"]["Enums"]["message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          division: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          phone: string | null
          position: string | null
          shift_id: string | null
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          division?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          phone?: string | null
          position?: string | null
          shift_id?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          division?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          phone?: string | null
          position?: string | null
          shift_id?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          color: string
          created_at: string
          days_of_week: number[]
          end_time: string
          id: string
          is_active: boolean
          name: string
          start_time: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          days_of_week?: number[]
          end_time: string
          id?: string
          is_active?: boolean
          name: string
          start_time: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          days_of_week?: number[]
          end_time?: string
          id?: string
          is_active?: boolean
          name?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_default: boolean
          is_terminal: boolean
          is_won: boolean
          name: string
          order_index: number
          owner_role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_terminal?: boolean
          is_won?: boolean
          name: string
          order_index?: number
          owner_role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_terminal?: boolean
          is_won?: boolean
          name?: string
          order_index?: number
          owner_role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          is_quick_reply: boolean | null
          name: string
          sort_order: number | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: string
          is_quick_reply?: boolean | null
          name: string
          sort_order?: number | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          is_quick_reply?: boolean | null
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_gateway_logs: {
        Row: {
          conversation_id: string | null
          created_at: string
          direction: string
          error_code: string | null
          error_message: string | null
          event: string
          id: string
          level: string
          message_sid: string | null
          payload: Json | null
          status: string | null
          to_number: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          event: string
          id?: string
          level?: string
          message_sid?: string | null
          payload?: Json | null
          status?: string | null
          to_number?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          event?: string
          id?: string
          level?: string
          message_sid?: string | null
          payload?: Json | null
          status?: string | null
          to_number?: string | null
        }
        Relationships: []
      }
      workflow_steps: {
        Row: {
          config: Json
          created_at: string
          id: string
          label: string | null
          mapping: string | null
          position: number
          prompt: string | null
          type: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          label?: string | null
          mapping?: string | null
          position?: number
          prompt?: string | null
          type: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          label?: string | null
          mapping?: string | null
          position?: number
          prompt?: string | null
          type?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          parent_id: string | null
          published_at: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          parent_id?: string | null
          published_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          parent_id?: string | null
          published_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflows_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fr_can_see_contact: { Args: { _contact_id: string }; Returns: boolean }
      fr_can_see_conversation: { Args: { _conv_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "agent" | "first_response"
      conversation_status: "OPEN" | "PENDING" | "RESOLVED"
      message_direction: "INBOUND" | "OUTBOUND"
      message_status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED"
      message_type:
        | "TEXT"
        | "IMAGE"
        | "DOCUMENT"
        | "AUDIO"
        | "INTERNAL_NOTE"
        | "VIDEO"
        | "VOICE"
        | "STICKER"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["super_admin", "admin", "agent", "first_response"],
      conversation_status: ["OPEN", "PENDING", "RESOLVED"],
      message_direction: ["INBOUND", "OUTBOUND"],
      message_status: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"],
      message_type: [
        "TEXT",
        "IMAGE",
        "DOCUMENT",
        "AUDIO",
        "INTERNAL_NOTE",
        "VIDEO",
        "VOICE",
        "STICKER",
      ],
    },
  },
} as const
