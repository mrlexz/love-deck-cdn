// supabase/functions/question-api/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

interface Option {
  text_en: string;
  text_vi: string;
  is_correct?: boolean;
}

interface CreateQuestionRequest {
  question_en: string;
  question_vi: string;
  is_active?: boolean;
  example_vi?: string;
  example_en?: string;
  topic_id?: string;
  question_variant_name: "open_ended" | "multiple_choice";
  question_variant_options?: Option[];
}

serve(async (req) => {
  // Xử lý CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Khởi tạo Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const url = new URL(req.url);
    const questionId = url.searchParams.get("id");

    // GET: Lấy question với variants và options
    if (req.method === "GET") {
      let query = supabaseClient
        .from("questions")
        .select(
          `
          *,
          question_variant (
            *,
            options (*)
          )
        `
        )
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("updated_at", { ascending: false });

      if (questionId) {
        query = query.eq("id", questionId).single();
      }

      const { data, error } = await query;

      if (error) {
        console.error("Database error:", error);
        throw error;
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: data,
          message: questionId
            ? "Question retrieved successfully"
            : "Questions retrieved successfully",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // POST: Tạo question mới với variants và options
    if (req.method === "POST") {
      const body: CreateQuestionRequest = await req.json();

      // Validation
      if (!body.question_en || !body.question_vi) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "thiếu trường question_en và question_vi",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (
        !body.question_variant_name ||
        !["open_ended", "multiple_choice"].includes(body.question_variant_name)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "question_variant_name là bắt buộc và phải là open_ended hoặc multiple_choice",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (
        body.question_variant_name === "multiple_choice" &&
        (!body.question_variant_options ||
          body.question_variant_options.length === 0)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "question_variant_options là bắt buộc khi question_variant_name là multiple_choice",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Bắt đầu transaction
      const { data: question, error: questionError } = await supabaseClient
        .from("questions")
        .insert([
          {
            question_en: body.question_en,
            question_vi: body.question_vi,
            is_active: body.is_active ?? true,
            example_vi: body.example_vi,
            example_en: body.example_en,
          },
        ])
        .select()
        .single();

      if (questionError) {
        console.error("Question creation error:", questionError);
        throw questionError;
      }

      // Tạo question variants
      const variantsToInsert = [
        {
          name: body.question_variant_name,
          question_id: question.id,
        },
      ];

      const { data: variants, error: variantsError } = await supabaseClient
        .from("question_variant")
        .insert(variantsToInsert)
        .select();

      if (variantsError) {
        console.error("Variants creation error:", variantsError);
        // Rollback - xóa question đã tạo
        await supabaseClient.from("questions").delete().eq("id", question.id);
        throw variantsError;
      }

      if (
        body.question_variant_name === "multiple_choice" &&
        body.question_variant_options &&
        body.question_variant_options.length > 0
      ) {
        const optionsToInsert = body.question_variant_options.map((option) => ({
          text_en: option.text_en,
          text_vi: option.text_vi,
          is_correct: option.is_correct ?? false,
          question_variant_id: variants[0].id,
        }));
        const { data: options, error: optionsError } = await supabaseClient
          .from("options")
          .insert(optionsToInsert)
          .select();

        if (optionsError) {
          console.error("Options creation error:", optionsError);
          // Rollback - xóa question và variants đã tạo
          await supabaseClient
            .from("question_variant")
            .delete()
            .eq("question_id", question.id);
          await supabaseClient.from("questions").delete().eq("id", question.id);
          throw optionsError;
        }
      }

      // Lấy dữ liệu complete để trả về
      const { data: completeQuestion } = await supabaseClient
        .from("questions")
        .select(
          `
          *,
          question_variant (
            *,
            options (*)
          )
        `
        )
        .eq("id", question.id)
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          data: completeQuestion,
          message: "Thêm câu hỏi thành công",
        }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // PUT: Cập nhật question
    if (req.method === "PUT") {
      if (!questionId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Question ID is required",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const body: Partial<CreateQuestionRequest> = await req.json();

      // Cập nhật question
      const { data: updatedQuestion, error: updateError } = await supabaseClient
        .from("questions")
        .update({
          question_en: body.question_en,
          question_vi: body.question_vi,
          is_active: body.is_active,
          example_vi: body.example_vi,
          example_en: body.example_en,
          updated_at: new Date(),
        })
        .eq("id", questionId)
        .select()
        .single();

      if (updateError) {
        console.error("Question update error:", updateError);
        throw updateError;
      }

      if (
        !body.question_variant_name ||
        !["open_ended", "multiple_choice"].includes(body.question_variant_name)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "question_variant_name là bắt buộc và phải là open_ended hoặc multiple_choice",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (
        body.question_variant_name === "multiple_choice" &&
        (!body.question_variant_options ||
          body.question_variant_options.length === 0)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "question_variant_options là bắt buộc khi question_variant_name là multiple_choice",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: updatedVariant, error: variantError } = await supabaseClient
        .from("question_variant")
        .update({
          name: body.question_variant_name,
          updated_at: new Date(),
        })
        .eq("question_id", questionId)
        .select()
        .single();

      if (variantError) {
        console.error("Variant update error:", variantError);
        throw variantError;
      }

      // Xóa tất cả options cũ
      await supabaseClient
        .from("options")
        .delete()
        .eq("question_variant_id", updatedVariant.id);

      if (
        updatedVariant.name === "multiple_choice" &&
        body.question_variant_options
      ) {
        const optionsToInsert = body.question_variant_options.map((option) => ({
          text_en: option.text_en,
          text_vi: option.text_vi,
          is_correct: option.is_correct ?? false,
          question_variant_id: updatedVariant.id,
          created_at: new Date(),
          updated_at: new Date(),
        }));

        const { error: optionsError } = await supabaseClient
          .from("options")
          .insert(optionsToInsert);

        if (optionsError) {
          console.error("Options update error:", optionsError);
          throw optionsError;
        }
      }

      // Lấy dữ liệu complete để trả về
      const { data: completeQuestion } = await supabaseClient
        .from("questions")
        .select(
          `
          *,
          question_variant (
            *,
            options (*)
          )
        `
        )
        .eq("id", questionId)
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          data: completeQuestion,
          message: "Question updated successfully",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // DELETE: Xóa question (sẽ cascade xóa variants và options)
    if (req.method === "DELETE") {
      if (!questionId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Question ID is required",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Xóa question (cascade sẽ tự động xóa variants và options)
      const { error } = await supabaseClient
        .from("questions")
        .update({ 
          deleted_at: new Date() // Cập nhật thời gian
        })
        .eq("id", questionId);

      if (error) {
        console.error("Question delete error:", error);
        throw error;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Question deleted successfully",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Method không được hỗ trợ
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Function error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
