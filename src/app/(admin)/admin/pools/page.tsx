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

export default async function PoolsPage() {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (me.role !== Role.ADMIN_KUBRI) redirect("/dashboard");

  const pools = await listPoolsWithCounts();

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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
