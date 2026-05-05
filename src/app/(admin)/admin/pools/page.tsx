import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { listPoolsWithCounts } from "@/lib/pools/queries";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PoolQrDialog } from "@/components/pools/pool-qr-dialog";
import { buildWaLink, buildWaMessage } from "@/lib/whatsapp/build-link";

export default async function PoolsPage() {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (me.role !== Role.ADMIN_KUBRI) redirect("/dashboard");

  const pools = await listPoolsWithCounts();

  const waNumber = process.env.KUBRI_WHATSAPP_NUMBER ?? "";
  const waTemplate = process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE ?? "";
  const waConfigured = waNumber.length > 0 && waTemplate.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">Pool</h1>
          <p className="mt-1 text-muted-foreground">
            Gestisci i pool di candidati e le organizzazioni che vi accedono.
          </p>
        </div>
        <a href="/admin/pools/new">
          <Button>Nuovo pool</Button>
        </a>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>External key</TableHead>
            <TableHead>Candidati</TableHead>
            <TableHead>Organizations</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pools.map((pool) => (
            <TableRow key={pool.id}>
              <TableCell className="font-medium">
                <a
                  href={`/admin/pools/${pool.id}`}
                  className="hover:underline"
                >
                  {pool.name}
                </a>
              </TableCell>
              <TableCell className="font-mono text-sm">{pool.slug}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {pool.externalKey ?? "—"}
              </TableCell>
              <TableCell>{pool._count.candidates}</TableCell>
              <TableCell>{pool._count.organizations}</TableCell>
              <TableCell>
                {pool.isGlobal && <Badge variant="secondary">Global</Badge>}
              </TableCell>
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
