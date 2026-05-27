import { requireOrganization } from "@/lib/auth-utils";
import { getCandidateForOrg } from "@/lib/candidates/service";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderCandidatePdf } from "@/components/export/candidate-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return new Response("Non autorizzato", { status: 401 });
  }

  const { id } = await params;
  const { organizationId } = session;

  try {
    const [candidate, notes] = await Promise.all([
      getCandidateForOrg(organizationId, id),
      prisma.candidateNote.findMany({
        where: { candidateId: id, organizationId },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!candidate) {
      return new Response("Candidato non trovato", { status: 404 });
    }

    const formattedNotes = notes.map((n) => ({
      content: n.content,
      userName: n.user?.name ?? "Utente eliminato",
      createdAt: n.createdAt,
    }));

    const pdfDocument = renderCandidatePdf({
      candidate,
      notes: formattedNotes,
    });

    const buffer = await renderToBuffer(pdfDocument);

    const today = new Date().toISOString().slice(0, 10);
    const fullName = `${candidate.firstName} ${candidate.lastName}`.trim();
    const safeName = fullName
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    await logAudit({
      userId: session.id,
      organizationId,
      action: "export.pdf",
      resourceType: "candidates",
      resourceId: id,
      metadata: {
        candidateName: fullName,
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="candidato-${safeName}-${today}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[pdf export]", err);
    return new Response("Errore durante l'esportazione", { status: 500 });
  }
}
