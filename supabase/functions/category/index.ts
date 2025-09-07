// supabase/functions/question-api/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

interface CreateCategoryRequest {
  name_en: string;
  name_vi: string;
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
    const topicId = url.searchParams.get("id");

    // GET: Lấy question với variants và options
    if (req.method === "GET") {
      let query = supabaseClient
        .from("topics")
        .select(
          `
          *
        `
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })

      if (topicId) {
        query = query.eq("id", topicId).single();
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
          message: topicId
            ? "Topic retrieved successfully"
            : "Topics retrieved successfully",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // POST: Tạo question mới với variants và options
    if (req.method === "POST") {
      const body: CreateCategoryRequest = await req.json();
      const { data, error } = await supabaseClient
        .from("topics")
        .insert([
          {
            name_en: body.name_en,
            name_vi: body.name_vi,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Topic creation error:", error);
        throw error;
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: data,
          message: "Topic created successfully",
        }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // PUT: Cập nhật question
    if (req.method === "PUT") {
      if (!topicId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Category ID is required",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const body: Partial<CreateCategoryRequest> = await req.json();

      // Cập nhật question
      const { data: updatedQuestion, error: updateError } = await supabaseClient
        .from("topics")
        .update({
          name_en: body.name_en,
          name_vi: body.name_vi,
          updated_at: new Date(),
        })
        .eq("id", topicId)
        .select()
        .single();

      if (updateError) {
        console.error("Question update error:", updateError);
        throw updateError;
      }

      // Lấy dữ liệu complete để trả về
      const { data: completeQuestion } = await supabaseClient
        .from("topics")
        .select(
          `
          *
        `
        )
        .eq("id", topicId)
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
      if (!topicId) {
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
        .from("topics")
        .update({ 
          deleted_at: new Date() // Cập nhật thời gian
        })
        .eq("id", topicId);

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
