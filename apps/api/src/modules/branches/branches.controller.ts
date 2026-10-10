import { Controller, Get } from '@nestjs/common';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /** Daftar cabang aktif untuk pemilih cabang di PWA. */
  @Get()
  list() {
    return this.branches.list();
  }
}
