import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthResponse, SessionUser } from "@property-review/shared";

import { DemoDataService } from "../shared/demo-data.service";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  constructor(@Inject(DemoDataService) private readonly data: DemoDataService) {}

  login(payload: LoginDto): AuthResponse {
    const user = this.data.findUserByUsername(payload.username);
    if (!user || user.password !== payload.password) {
      throw new UnauthorizedException("\u7528\u6237\u540d\u6216\u5bc6\u7801\u4e0d\u6b63\u786e");
    }

    return {
      token: user.id,
      user: this.data.getSessionUser(user.id)
    };
  }

  requireSession(userId?: string): SessionUser {
    if (!userId) {
      throw new UnauthorizedException("\u767b\u5f55\u4f1a\u8bdd\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55");
    }
    return this.data.getSessionUser(userId);
  }
}
