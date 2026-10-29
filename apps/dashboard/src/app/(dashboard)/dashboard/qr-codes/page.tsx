import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { listOrgPoolsWithCandidateCount } from "@/lib/pools/queries";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getLandingForOrg } from "@/lib/landing/service";
import { getAppOrigin } from "@/lib/origin";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { LandingQrDialog } from "@/components/landing/landing-qr-dialog";
import { PoolQrDialog } from "@/components/pools/pool-qr-dialog";
import { buildWaLink, buildWaMessage } from "@/lib/whatsapp/build-link";

export default async function QrCodesPage() {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/login");
  }

  const pools = me.organizationId
    ? await listOrgPoolsWithCandidateCount(me.organizationId)
    : [];

  const t = getDictionary(await getServerLocale());
  const landing = me.organizationId ? await getLandingForOrg(me.organizationId) : null;
  const landingUrl = landing?.enabled ? `${await getAppOrigin()}/candidati/${landing.slug}` : null;

  const waNumber = process.env.KUBRI_WHATSAPP_NUMBER ?? "";
  const waTemplate = process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE ?? "";
  const waConfigured = waNumber.length > 0 && waTemplate.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">QR code</h1>
        <p className="mt-1 text-muted-foreground">
          QR code WhatsApp dei pool agganciati alla tua organizzazione.
        </p>
      </div>

      {landingUrl && (
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-lg">{t.landingAdmin.qrPageTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.landingAdmin.qrPageDescription}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={landingUrl} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline">
              {landingUrl}
            </a>
            <LandingQrDialog name={t.landingAdmin.qrPageTitle} url={landingUrl} />
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome pool</TableHead>
            <TableHead>Candidati</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pools.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="text-center text-muted-foreground"
              >
                Nessun pool disponibile.
              </TableCell>
            </TableRow>
          ) : (
            pools.map((pool) => (
              <TableRow key={pool.id}>
                <TableCell className="font-medium">{pool.name}</TableCell>
                <TableCell>{pool._count.candidates}</TableCell>
                <TableCell className="text-right">
                  <PoolQrDialog
                    poolName={pool.name}
                    waLink={
                      waConfigured
                        ? buildWaLink(
                            {
                              isGlobal: pool.isGlobal,
                              externalKey: pool.externalKey,
                              slug: pool.slug,
                            },
                            waNumber,
                            waTemplate,
                          )
                        : null
                    }
                    messageText={
                      waConfigured
                        ? buildWaMessage(
                            {
                              isGlobal: pool.isGlobal,
                              externalKey: pool.externalKey,
                              slug: pool.slug,
                            },
                            waTemplate,
                          )
                        : null
                    }
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
