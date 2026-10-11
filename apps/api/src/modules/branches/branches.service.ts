import { Injectable, NotFoundException } from '@nestjs/common';
import { BranchesRepository } from './branches.repository';

@Injectable()
export class BranchesService {
  constructor(private readonly branches: BranchesRepository) {}

  list() {
    return this.branches.findActive();
  }

  async getActive(code: string) {
    const branch = await this.branches.findActiveByCode(code);
    if (!branch) throw new NotFoundException(`Cabang ${code} tidak ditemukan`);
    return branch;
  }
}
