-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlanKey" AS ENUM ('FREE', 'COUNTY', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NOTICE_OF_TRUSTEE_SALE', 'AMENDED_NOTICE', 'CANCELLATION_NOTICE', 'POSTPONEMENT_NOTICE', 'DEED_OF_TRUST', 'ASSIGNMENT_OF_LIEN', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentProcessingStatus" AS ENUM ('DISCOVERED', 'DOWNLOADED', 'TEXT_EXTRACTED', 'DETERMINISTIC_EXTRACTED', 'AI_EXTRACTED', 'RESOLVED', 'SUMMARIZED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ManualReviewStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'IN_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('SCHEDULED', 'POSTPONED', 'CANCELED', 'SOLD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('NOT_CANCELED', 'CANCELED', 'WITHDRAWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PartyEntityType" AS ENUM ('INDIVIDUAL', 'ENTITY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY', 'MULTI_FAMILY', 'CONDO', 'TOWNHOUSE', 'MOBILE_HOME', 'VACANT_LAND', 'COMMERCIAL', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PropertyClassification" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AddressResolutionMethod" AS ENUM ('EXPLICIT_STATED', 'COMMONLY_KNOWN_AS_PHRASE', 'LEGAL_DESCRIPTION_MATCH', 'PROPERTY_ID_MATCH', 'OWNER_MAILING_ADDRESS_MATCH', 'GEOCODING', 'MANUAL', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "FieldSourceType" AS ENUM ('FORECLOSURE_NOTICE', 'COUNTY_CLERK', 'APPRAISAL_DISTRICT', 'GEOCODING_SERVICE', 'THIRD_PARTY_DATA', 'CALCULATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ManualReviewReason" AS ENUM ('NO_ADDRESS_RESOLVED', 'MULTIPLE_APPRAISAL_MATCHES', 'SALE_DATE_CONFLICT', 'BORROWER_NAME_CONFLICT', 'POOR_TEXT_QUALITY', 'PROPERTY_CLASSIFICATION_UNCERTAIN', 'LOW_CONFIDENCE', 'USER_REPORTED');

-- CreateEnum
CREATE TYPE "ManualReviewTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ProcessingJobType" AS ENUM ('DISCOVER_NOTICES', 'DOWNLOAD_DOCUMENT', 'EXTRACT_TEXT', 'OCR_PAGE', 'DETERMINISTIC_EXTRACT', 'AI_EXTRACT', 'ADDRESS_RESOLUTION', 'GENERATE_SUMMARY', 'RECHECK_NOTICE');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('LENDER', 'SERVICER', 'TRUSTEE_COMPANY', 'TITLE_COMPANY', 'LAW_FIRM', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('OPEN', 'REVIEWED', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('NEW_MATCHING_PROPERTY', 'ADDRESS_RESOLVED', 'SALE_DATE_CHANGED', 'SALE_CANCELED', 'SAVED_PROPERTY_REMINDER', 'UPCOMING_AUCTION_REMINDER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WEB_PUSH', 'EXPO_PUSH');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_configs" (
    "id" TEXT NOT NULL,
    "plan_key" "PlanKey" NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "monthly_csv_export_limit" INTEGER NOT NULL DEFAULT 0,
    "max_saved_properties" INTEGER NOT NULL DEFAULT 10,
    "can_view_documents" BOOLEAN NOT NULL DEFAULT false,
    "can_receive_alerts" BOOLEAN NOT NULL DEFAULT false,
    "can_view_record_history" BOOLEAN NOT NULL DEFAULT false,
    "available_county_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "plan" "PlanKey" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "current_period_end" TIMESTAMP(3),
    "csv_exports_used_this_month" INTEGER NOT NULL DEFAULT 0,
    "csv_exports_reset_at" TIMESTAMP(3),
    "selected_county_id" TEXT,
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'TX',
    "fips_code" TEXT,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "county_sources" (
    "id" TEXT NOT NULL,
    "county_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "adapter_key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 1440,
    "last_attempt_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "notices_discovered_count" INTEGER NOT NULL DEFAULT 0,
    "documents_downloaded_count" INTEGER NOT NULL DEFAULT 0,
    "documents_processed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "county_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FieldSourceType" NOT NULL,
    "base_url" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "county_id" TEXT NOT NULL,
    "county_source_id" TEXT,
    "foreclosure_case_id" TEXT,
    "source_url" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "county_filing_number" TEXT,
    "filing_date" TIMESTAMP(3),
    "document_type" "DocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "page_count" INTEGER,
    "date_collected" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_last_checked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sha256_hash" TEXT NOT NULL,
    "storage_key" TEXT,
    "extraction_version" INTEGER NOT NULL DEFAULT 1,
    "extraction_confidence" DOUBLE PRECISION,
    "manual_review_status" "ManualReviewStatus" NOT NULL DEFAULT 'NOT_NEEDED',
    "language" TEXT DEFAULT 'en',
    "ocr_used" BOOLEAN NOT NULL DEFAULT false,
    "processing_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "DocumentProcessingStatus" NOT NULL DEFAULT 'DISCOVERED',
    "raw_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "mailing_address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'OTHER',
    "mailing_address" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trustees" (
    "id" TEXT NOT NULL,
    "person_id" TEXT,
    "organization_id" TEXT,
    "phone" TEXT,
    "mailing_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trustees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foreclosure_cases" (
    "id" TEXT NOT NULL,
    "county_id" TEXT NOT NULL,
    "property_id" TEXT,
    "case_number" TEXT,
    "status" "SaleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "entity_type" "PartyEntityType" NOT NULL DEFAULT 'UNKNOWN',
    "owner_occupied" BOOLEAN,
    "homestead" BOOLEAN,
    "borrower_person_id" TEXT,
    "grantor_person_id" TEXT,
    "current_owner_person_id" TEXT,
    "co_owner_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary_text" TEXT,
    "summary_generated_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreclosure_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foreclosure_sales" (
    "id" TEXT NOT NULL,
    "foreclosure_case_id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "sale_date" TIMESTAMP(3),
    "sale_time" TEXT,
    "sale_location" TEXT,
    "notice_posting_date" TIMESTAMP(3),
    "earliest_sale_date" TIMESTAMP(3),
    "sale_status" "SaleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancellation_status" "CancellationStatus" NOT NULL DEFAULT 'NOT_CANCELED',
    "trustee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreclosure_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "foreclosure_case_id" TEXT NOT NULL,
    "original_lender_org_id" TEXT,
    "current_mortgagee_org_id" TEXT,
    "mortgage_servicer_org_id" TEXT,
    "original_principal_amount_cents" INTEGER,
    "original_loan_date" TIMESTAMP(3),
    "deed_of_trust_date" TIMESTAMP(3),
    "instrument_number" TEXT,
    "recording_date" TIMESTAMP(3),
    "loan_maturity_date" TIMESTAMP(3),
    "current_principal_balance_cents" INTEGER,
    "estimated_remaining_balance_cents" INTEGER,
    "remaining_balance_methodology" TEXT,
    "remaining_balance_confidence" DOUBLE PRECISION,
    "remaining_balance_assumptions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "county_id" TEXT NOT NULL,
    "property_street_address" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL DEFAULT 'TX',
    "zip_code" TEXT,
    "legal_description" TEXT,
    "subdivision" TEXT,
    "lot" TEXT,
    "block" TEXT,
    "acreage" DOUBLE PRECISION,
    "property_id_number" TEXT,
    "geographic_id" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "property_type" "PropertyType" NOT NULL DEFAULT 'UNKNOWN',
    "classification" "PropertyClassification" NOT NULL DEFAULT 'UNKNOWN',
    "appraised_value_cents" INTEGER,
    "assessed_value_cents" INTEGER,
    "estimated_market_value_cents" INTEGER,
    "last_sale_date" TIMESTAMP(3),
    "last_sale_price_cents" INTEGER,
    "address_resolution_method" "AddressResolutionMethod" NOT NULL DEFAULT 'UNRESOLVED',
    "address_resolution_confidence" DOUBLE PRECISION,
    "address_resolution_explanation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_addresses" (
    "id" TEXT NOT NULL,
    "foreclosure_case_id" TEXT NOT NULL,
    "property_id" TEXT,
    "rawAddressText" TEXT NOT NULL,
    "method" "AddressResolutionMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_descriptions" (
    "id" TEXT NOT NULL,
    "foreclosure_case_id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "rawText" TEXT NOT NULL,
    "subdivision" TEXT,
    "lot" TEXT,
    "block" TEXT,
    "acreage" DOUBLE PRECISION,
    "survey_name" TEXT,
    "abstract_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_descriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "value" TEXT,
    "source_type" "FieldSourceType" NOT NULL,
    "source_url" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMP(3),
    "methodology" TEXT,
    "explicitly_stated" BOOLEAN NOT NULL DEFAULT false,
    "supporting_text" TEXT,
    "page_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_jobs" (
    "id" TEXT NOT NULL,
    "type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_document_id" TEXT,
    "foreclosure_case_id" TEXT,
    "county_source_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error" TEXT,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_review_tasks" (
    "id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "foreclosure_case_id" TEXT,
    "reason" "ManualReviewReason" NOT NULL,
    "status" "ManualReviewTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "manual_review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "limit_cents" INTEGER NOT NULL,
    "alert_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_properties" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "filter_params" JSONB NOT NULL,
    "row_count" INTEGER,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_reports" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT,
    "property_id" TEXT,
    "foreclosure_case_id" TEXT,
    "field_name" TEXT,
    "description" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,

    CONSTRAINT "correction_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "web_push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "expo_push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "event_types_enabled" "NotificationEventType"[] DEFAULT ARRAY['NEW_MATCHING_PROPERTY', 'SALE_DATE_CHANGED', 'SALE_CANCELED', 'UPCOMING_AUCTION_REMINDER']::"NotificationEventType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "payload" JSONB,
    "delivered_channels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plan_configs_plan_key_key" ON "plan_configs"("plan_key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_profile_id_key" ON "subscriptions"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "counties_slug_key" ON "counties"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_key_key" ON "data_sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "source_documents_sha256_hash_key" ON "source_documents"("sha256_hash");

-- CreateIndex
CREATE INDEX "source_documents_county_id_idx" ON "source_documents"("county_id");

-- CreateIndex
CREATE INDEX "source_documents_foreclosure_case_id_idx" ON "source_documents"("foreclosure_case_id");

-- CreateIndex
CREATE INDEX "source_documents_manual_review_status_idx" ON "source_documents"("manual_review_status");

-- CreateIndex
CREATE INDEX "people_full_name_idx" ON "people"("full_name");

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "foreclosure_cases_county_id_idx" ON "foreclosure_cases"("county_id");

-- CreateIndex
CREATE INDEX "foreclosure_cases_property_id_idx" ON "foreclosure_cases"("property_id");

-- CreateIndex
CREATE INDEX "foreclosure_cases_status_idx" ON "foreclosure_cases"("status");

-- CreateIndex
CREATE INDEX "foreclosure_sales_foreclosure_case_id_idx" ON "foreclosure_sales"("foreclosure_case_id");

-- CreateIndex
CREATE INDEX "foreclosure_sales_sale_date_idx" ON "foreclosure_sales"("sale_date");

-- CreateIndex
CREATE UNIQUE INDEX "loans_foreclosure_case_id_key" ON "loans"("foreclosure_case_id");

-- CreateIndex
CREATE INDEX "loans_original_principal_amount_cents_idx" ON "loans"("original_principal_amount_cents");

-- CreateIndex
CREATE INDEX "properties_county_id_idx" ON "properties"("county_id");

-- CreateIndex
CREATE INDEX "properties_city_idx" ON "properties"("city");

-- CreateIndex
CREATE INDEX "properties_zip_code_idx" ON "properties"("zip_code");

-- CreateIndex
CREATE INDEX "properties_property_type_idx" ON "properties"("property_type");

-- CreateIndex
CREATE INDEX "properties_classification_idx" ON "properties"("classification");

-- CreateIndex
CREATE INDEX "properties_address_resolution_confidence_idx" ON "properties"("address_resolution_confidence");

-- CreateIndex
CREATE INDEX "properties_appraised_value_cents_idx" ON "properties"("appraised_value_cents");

-- CreateIndex
CREATE INDEX "property_addresses_foreclosure_case_id_idx" ON "property_addresses"("foreclosure_case_id");

-- CreateIndex
CREATE INDEX "legal_descriptions_foreclosure_case_id_idx" ON "legal_descriptions"("foreclosure_case_id");

-- CreateIndex
CREATE INDEX "extracted_fields_entity_type_entity_id_idx" ON "extracted_fields"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "extracted_fields_source_document_id_idx" ON "extracted_fields"("source_document_id");

-- CreateIndex
CREATE INDEX "processing_jobs_status_run_at_idx" ON "processing_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "processing_jobs_type_idx" ON "processing_jobs"("type");

-- CreateIndex
CREATE INDEX "manual_review_tasks_status_idx" ON "manual_review_tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_limits_key_key" ON "budget_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "saved_properties_profile_id_property_id_key" ON "saved_properties"("profile_id", "property_id");

-- CreateIndex
CREATE INDEX "correction_reports_status_idx" ON "correction_reports"("status");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_profile_id_key" ON "notification_preferences"("profile_id");

-- CreateIndex
CREATE INDEX "notification_events_profile_id_created_at_idx" ON "notification_events"("profile_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_selected_county_id_fkey" FOREIGN KEY ("selected_county_id") REFERENCES "counties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "county_sources" ADD CONSTRAINT "county_sources_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_county_source_id_fkey" FOREIGN KEY ("county_source_id") REFERENCES "county_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trustees" ADD CONSTRAINT "trustees_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trustees" ADD CONSTRAINT "trustees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_cases" ADD CONSTRAINT "foreclosure_cases_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_cases" ADD CONSTRAINT "foreclosure_cases_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_cases" ADD CONSTRAINT "foreclosure_cases_borrower_person_id_fkey" FOREIGN KEY ("borrower_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_cases" ADD CONSTRAINT "foreclosure_cases_grantor_person_id_fkey" FOREIGN KEY ("grantor_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_cases" ADD CONSTRAINT "foreclosure_cases_current_owner_person_id_fkey" FOREIGN KEY ("current_owner_person_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_sales" ADD CONSTRAINT "foreclosure_sales_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_sales" ADD CONSTRAINT "foreclosure_sales_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_sales" ADD CONSTRAINT "foreclosure_sales_trustee_id_fkey" FOREIGN KEY ("trustee_id") REFERENCES "trustees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_original_lender_org_id_fkey" FOREIGN KEY ("original_lender_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_current_mortgagee_org_id_fkey" FOREIGN KEY ("current_mortgagee_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_mortgage_servicer_org_id_fkey" FOREIGN KEY ("mortgage_servicer_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_addresses" ADD CONSTRAINT "property_addresses_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_addresses" ADD CONSTRAINT "property_addresses_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_descriptions" ADD CONSTRAINT "legal_descriptions_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_descriptions" ADD CONSTRAINT "legal_descriptions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_county_source_id_fkey" FOREIGN KEY ("county_source_id") REFERENCES "county_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_review_tasks" ADD CONSTRAINT "manual_review_tasks_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_review_tasks" ADD CONSTRAINT "manual_review_tasks_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_review_tasks" ADD CONSTRAINT "manual_review_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_reports" ADD CONSTRAINT "correction_reports_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_reports" ADD CONSTRAINT "correction_reports_foreclosure_case_id_fkey" FOREIGN KEY ("foreclosure_case_id") REFERENCES "foreclosure_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_reports" ADD CONSTRAINT "correction_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

