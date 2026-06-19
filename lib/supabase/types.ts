export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: Database['public']['Enums']['user_role']
          status: Database['public']['Enums']['user_status']
          can_record_payment: boolean | null
          can_export_reports: boolean | null
          can_see_financials: boolean | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: Database['public']['Enums']['user_role']
          status?: Database['public']['Enums']['user_status']
          can_record_payment?: boolean | null
          can_export_reports?: boolean | null
          can_see_financials?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: Database['public']['Enums']['user_role']
          status?: Database['public']['Enums']['user_status']
          can_record_payment?: boolean | null
          can_export_reports?: boolean | null
          can_see_financials?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          id: string
          name: string
          default_billing_day: number | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          default_billing_day?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          default_billing_day?: number | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          customer_code: string
          full_name: string
          company_id: string | null
          employee_id: string | null
          mobile_number: string
          whatsapp_number: string | null
          email: string | null
          area: string | null
          delivery_address: string | null
          delivery_instructions: string | null
          customer_type: Database['public']['Enums']['customer_type']
          status: Database['public']['Enums']['customer_status']
          billing_day: number | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_code: string
          full_name: string
          company_id?: string | null
          employee_id?: string | null
          mobile_number: string
          whatsapp_number?: string | null
          email?: string | null
          area?: string | null
          delivery_address?: string | null
          delivery_instructions?: string | null
          customer_type?: Database['public']['Enums']['customer_type']
          status?: Database['public']['Enums']['customer_status']
          billing_day?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_code?: string
          full_name?: string
          company_id?: string | null
          employee_id?: string | null
          mobile_number?: string
          whatsapp_number?: string | null
          email?: string | null
          area?: string | null
          delivery_address?: string | null
          delivery_instructions?: string | null
          customer_type?: Database['public']['Enums']['customer_type']
          status?: Database['public']['Enums']['customer_status']
          billing_day?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'customers_company_id_fkey'; columns: ['company_id']; referencedRelation: 'companies'; referencedColumns: ['id'] },
          { foreignKeyName: 'customers_created_by_fkey'; columns: ['created_by']; referencedRelation: 'users'; referencedColumns: ['id'] }
        ]
      }
      menu_items: {
        Row: {
          id: string
          name: string
          meal_period: Database['public']['Enums']['meal_period']
          category: string | null
          description: string | null
          default_price: string
          is_available: boolean
          image_url: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          meal_period: Database['public']['Enums']['meal_period']
          category?: string | null
          description?: string | null
          default_price: string
          is_available?: boolean
          image_url?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          meal_period?: Database['public']['Enums']['meal_period']
          category?: string | null
          description?: string | null
          default_price?: string
          is_available?: boolean
          image_url?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'menu_items_created_by_fkey'; columns: ['created_by']; referencedRelation: 'users'; referencedColumns: ['id'] }
        ]
      }
      daily_menus: {
        Row: {
          id: string
          menu_date: string
          uploaded_file_url: string | null
          notes: string | null
          is_published: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          menu_date: string
          uploaded_file_url?: string | null
          notes?: string | null
          is_published?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          menu_date?: string
          uploaded_file_url?: string | null
          notes?: string | null
          is_published?: boolean
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      daily_menu_items: {
        Row: {
          id: string
          daily_menu_id: string
          menu_item_id: string
          price_override: string | null
          is_available: boolean
        }
        Insert: {
          id?: string
          daily_menu_id: string
          menu_item_id: string
          price_override?: string | null
          is_available?: boolean
        }
        Update: {
          id?: string
          daily_menu_id?: string
          menu_item_id?: string
          price_override?: string | null
          is_available?: boolean
        }
        Relationships: []
      }
      fixed_plans: {
        Row: {
          id: string
          plan_name: string
          description: string | null
          meal_periods: Database['public']['Enums']['meal_period'][]
          default_monthly_price: string
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          plan_name: string
          description?: string | null
          meal_periods: Database['public']['Enums']['meal_period'][]
          default_monthly_price: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          plan_name?: string
          description?: string | null
          meal_periods?: Database['public']['Enums']['meal_period'][]
          default_monthly_price?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      customer_subscriptions: {
        Row: {
          id: string
          customer_id: string
          fixed_plan_id: string
          start_date: string
          end_date: string | null
          agreed_monthly_price: string
          status: string
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          fixed_plan_id: string
          start_date: string
          end_date?: string | null
          agreed_monthly_price: string
          status?: string
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          fixed_plan_id?: string
          start_date?: string
          end_date?: string | null
          agreed_monthly_price?: string
          status?: string
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          order_number: string
          customer_id: string
          order_date: string
          meal_period: Database['public']['Enums']['meal_period']
          subtotal: string
          discount_amount: string
          delivery_charge: string
          total_amount: string
          payment_status: Database['public']['Enums']['payment_status']
          order_status: Database['public']['Enums']['order_status']
          is_credit: boolean
          notes: string | null
          created_by: string
          created_at: string
          updated_by: string | null
          updated_at: string
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
        }
        Insert: {
          id?: string
          order_number: string
          customer_id: string
          order_date?: string
          meal_period: Database['public']['Enums']['meal_period']
          subtotal?: string
          discount_amount?: string
          delivery_charge?: string
          total_amount?: string
          payment_status?: Database['public']['Enums']['payment_status']
          order_status?: Database['public']['Enums']['order_status']
          is_credit?: boolean
          notes?: string | null
          created_by: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Update: {
          id?: string
          order_number?: string
          customer_id?: string
          order_date?: string
          meal_period?: Database['public']['Enums']['meal_period']
          subtotal?: string
          discount_amount?: string
          delivery_charge?: string
          total_amount?: string
          payment_status?: Database['public']['Enums']['payment_status']
          order_status?: Database['public']['Enums']['order_status']
          is_credit?: boolean
          notes?: string | null
          created_by?: string
          created_at?: string
          updated_by?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Relationships: [
          { foreignKeyName: 'orders_customer_id_fkey'; columns: ['customer_id']; referencedRelation: 'customers'; referencedColumns: ['id'] },
          { foreignKeyName: 'orders_created_by_fkey'; columns: ['created_by']; referencedRelation: 'users'; referencedColumns: ['id'] }
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          menu_item_id: string | null
          item_name_snapshot: string
          quantity: string
          unit_price: string
          total_price: string
          notes: string | null
        }
        Insert: {
          id?: string
          order_id: string
          menu_item_id?: string | null
          item_name_snapshot: string
          quantity: string
          unit_price: string
          total_price: string
          notes?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          menu_item_id?: string | null
          item_name_snapshot?: string
          quantity?: string
          unit_price?: string
          total_price?: string
          notes?: string | null
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          id: string
          customer_id: string
          order_id: string | null
          subscription_id: string | null
          delivery_date: string
          meal_period: Database['public']['Enums']['meal_period'] | null
          status: Database['public']['Enums']['delivery_status']
          skip_reason: string | null
          skip_note: string | null
          delivered_at: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          order_id?: string | null
          subscription_id?: string | null
          delivery_date?: string
          meal_period?: Database['public']['Enums']['meal_period'] | null
          status?: Database['public']['Enums']['delivery_status']
          skip_reason?: string | null
          skip_note?: string | null
          delivered_at?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          order_id?: string | null
          subscription_id?: string | null
          delivery_date?: string
          meal_period?: Database['public']['Enums']['meal_period'] | null
          status?: Database['public']['Enums']['delivery_status']
          skip_reason?: string | null
          skip_note?: string | null
          delivered_at?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          invoice_number: string
          customer_id: string
          invoice_date: string
          due_date: string
          invoice_type: Database['public']['Enums']['invoice_type']
          billing_period_start: string | null
          billing_period_end: string | null
          subtotal: string
          discount_amount: string
          tax_amount: string
          total_amount: string
          status: Database['public']['Enums']['invoice_status']
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          invoice_number: string
          customer_id: string
          invoice_date?: string
          due_date: string
          invoice_type: Database['public']['Enums']['invoice_type']
          billing_period_start?: string | null
          billing_period_end?: string | null
          subtotal?: string
          discount_amount?: string
          tax_amount?: string
          total_amount?: string
          status?: Database['public']['Enums']['invoice_status']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          invoice_number?: string
          customer_id?: string
          invoice_date?: string
          due_date?: string
          invoice_type?: Database['public']['Enums']['invoice_type']
          billing_period_start?: string | null
          billing_period_end?: string | null
          subtotal?: string
          discount_amount?: string
          tax_amount?: string
          total_amount?: string
          status?: Database['public']['Enums']['invoice_status']
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          order_id: string | null
          description: string
          quantity: string
          unit_price: string
          total_price: string
        }
        Insert: {
          id?: string
          invoice_id: string
          order_id?: string | null
          description: string
          quantity?: string
          unit_price: string
          total_price: string
        }
        Update: {
          id?: string
          invoice_id?: string
          order_id?: string | null
          description?: string
          quantity?: string
          unit_price?: string
          total_price?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          payment_number: string
          customer_id: string
          invoice_id: string | null
          payment_date: string
          amount: string
          mode: Database['public']['Enums']['payment_mode']
          reference_number: string | null
          notes: string | null
          received_by: string
          created_at: string
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
        }
        Insert: {
          id?: string
          payment_number: string
          customer_id: string
          invoice_id?: string | null
          payment_date?: string
          amount: string
          mode: Database['public']['Enums']['payment_mode']
          reference_number?: string | null
          notes?: string | null
          received_by: string
          created_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Update: {
          id?: string
          payment_number?: string
          customer_id?: string
          invoice_id?: string | null
          payment_date?: string
          amount?: string
          mode?: Database['public']['Enums']['payment_mode']
          reference_number?: string | null
          notes?: string | null
          received_by?: string
          created_at?: string
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          id: string
          customer_id: string
          entry_date: string
          entry_type: Database['public']['Enums']['ledger_type']
          debit_amount: string
          credit_amount: string
          description: string
          reference_table: string | null
          reference_id: string | null
          reversal_of: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          entry_date?: string
          entry_type: Database['public']['Enums']['ledger_type']
          debit_amount?: string
          credit_amount?: string
          description: string
          reference_table?: string | null
          reference_id?: string | null
          reversal_of?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          entry_date?: string
          entry_type?: Database['public']['Enums']['ledger_type']
          debit_amount?: string
          credit_amount?: string
          description?: string
          reference_table?: string | null
          reference_id?: string | null
          reversal_of?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      approval_requests: {
        Row: {
          id: string
          request_type: Database['public']['Enums']['approval_request_type']
          target_table: Database['public']['Enums']['approval_target']
          target_id: string
          reason: string
          proposed_changes: Json | null
          status: Database['public']['Enums']['approval_status']
          requested_by: string
          requested_at: string
          resolved_by: string | null
          resolved_at: string | null
          resolution_note: string | null
        }
        Insert: {
          id?: string
          request_type: Database['public']['Enums']['approval_request_type']
          target_table: Database['public']['Enums']['approval_target']
          target_id: string
          reason: string
          proposed_changes?: Json | null
          status?: Database['public']['Enums']['approval_status']
          requested_by: string
          requested_at?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_note?: string | null
        }
        Update: {
          id?: string
          request_type?: Database['public']['Enums']['approval_request_type']
          target_table?: Database['public']['Enums']['approval_target']
          target_id?: string
          reason?: string
          proposed_changes?: Json | null
          status?: Database['public']['Enums']['approval_status']
          requested_by?: string
          requested_at?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_note?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: number
          user_id: string | null
          action: string
          table_name: string | null
          record_id: string | null
          old_value: Json | null
          new_value: Json | null
          ip_address: string | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id?: string | null
          action: string
          table_name?: string | null
          record_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string | null
          action?: string
          table_name?: string | null
          record_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          created_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: number
          business_name: string
          currency: string
          timezone: string
          default_billing_day: number
          invoice_prefix: string
          order_prefix: string
          payment_prefix: string
          customer_prefix: string
          vat_percent: string
          contact_phone: string | null
          contact_email: string | null
          country: string
          bank_account_name: string
          bank_iban: string
          bank_name: string
          updated_at: string
        }
        Insert: {
          id?: number
          business_name?: string
          currency?: string
          timezone?: string
          default_billing_day?: number
          invoice_prefix?: string
          order_prefix?: string
          payment_prefix?: string
          customer_prefix?: string
          vat_percent?: string
          contact_phone?: string | null
          contact_email?: string | null
          country?: string
          bank_account_name?: string
          bank_iban?: string
          bank_name?: string
          updated_at?: string
        }
        Update: {
          id?: number
          business_name?: string
          currency?: string
          timezone?: string
          default_billing_day?: number
          invoice_prefix?: string
          order_prefix?: string
          payment_prefix?: string
          customer_prefix?: string
          vat_percent?: string
          contact_phone?: string | null
          contact_email?: string | null
          country?: string
          bank_account_name?: string
          bank_iban?: string
          bank_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      customer_balances: {
        Row: {
          customer_id: string | null
          full_name: string | null
          company_id: string | null
          balance: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_app_user: {
        Args: Record<PropertyKey, never>
        Returns: Database['public']['Tables']['users']['Row']
      }
      is_active_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      has_role: {
        Args: { roles: Database['public']['Enums']['user_role'][] }
        Returns: boolean
      }
      effective_billing_day: {
        Args: { c: Database['public']['Tables']['customers']['Row'] }
        Returns: number
      }
      next_customer_code: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      next_order_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      next_payment_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      next_invoice_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      user_role: 'owner' | 'manager' | 'data_entry' | 'accounts' | 'viewer' | 'packer'
      user_status: 'pending' | 'active' | 'inactive'
      customer_type: 'a_la_carte' | 'fixed_menu' | 'hybrid'
      customer_status: 'active' | 'paused' | 'inactive' | 'blacklisted'
      meal_period: 'breakfast' | 'lunch' | 'dinner'
      order_status: 'draft' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'voided'
      payment_status: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'written_off'
      delivery_status: 'pending' | 'out_for_delivery' | 'delivered' | 'skipped' | 'failed' | 'cancelled'
      payment_mode: 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'online' | 'wallet' | 'other'
      invoice_type: 'a_la_carte_cycle' | 'fixed_monthly' | 'adhoc'
      invoice_status: 'draft' | 'issued' | 'partial' | 'paid' | 'overdue' | 'cancelled' | 'written_off'
      ledger_type: 'order' | 'invoice' | 'payment' | 'discount' | 'refund' | 'write_off' | 'adjustment' | 'opening_balance'
      approval_request_type: 'delete' | 'edit'
      approval_status: 'pending' | 'approved' | 'rejected'
      approval_target: 'order' | 'payment' | 'invoice'
    }
    CompositeTypes: Record<PropertyKey, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
