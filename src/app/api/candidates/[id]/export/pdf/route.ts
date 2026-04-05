import { auth } from "@/lib/auth";
import { getCandidateForOrg } from "@/lib/make/service";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderCandidatePdf } from "@/components/export/candidate-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId || !session.user.id) {
    return new Response("Non autorizzato", { status: 401 });
  }

  const { id } = await params;
  const { organizationId } = session.user;

  try {
    const [candidate, notes] = await Promise.all([
      getCandidateForOrg(organizationId, id),
      prisma.candidateNote.findMany({
        where: {
          makeRecordId: id,
          organizationId,
        },
        include: {
          user: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!candidate) {
      return new Response("Candidato non trovato", { status: 404 });
    }

    const formattedNotes = notes.map((n) => ({
      content: n.content,
      userName: n.user.name,
      createdAt: n.createdAt,
    }));

    const pdfDocument = renderCandidatePdf({
      candidate,
      notes: formattedNotes,
    });

    const buffer = await renderToBuffer(pdfDocument);

    const today = new Date().toISOString().slice(0, 10);
    const safeName = candidate.name
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    await logAudit({
      userId: session.user.id,
      organizationId,
      action: "export.pdf",
      resourceType: "candidates",
      resourceId: id,
      metadata: {
        candidateName: candidate.name,
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="candidato-${safeName}-${today}.pdf"`,
      },
    });
  } catch {
    return new Response("Errore durante l'esportazione", { status: 500 });
  }
}
